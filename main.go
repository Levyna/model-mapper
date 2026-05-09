package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

//go:embed index.html
var indexHTML []byte

// Route 是单个路由配置。
type Route struct {
	UpstreamURL   string   `json:"upstream_url"`
	UpstreamToken string   `json:"upstream_token"`
	Protocol      string   `json:"protocol"` // "anthropic" | "openai"
	TargetModel   string   `json:"target_model"`
	MappedModels  []string `json:"mapped_models"`
}

// Config 是代理服务的全部配置，持久化到 config.json。
type Config struct {
	Port   int     `json:"port"`
	Routes []Route `json:"routes"`
}

func defaultConfig() Config {
	return Config{
		Port: 3000,
		Routes: []Route{
			{
				UpstreamURL:   "https://token-plan-ams.xiaomimimo.com/anthropic",
				UpstreamToken: "tp-eq2axaku7f1gkofql2d6n1yk2woammvr0njsy0y43u9mx8tv",
				Protocol:      "anthropic",
				TargetModel:   "mimo-v2.5-pro",
				MappedModels:  []string{"claude-opus-4-6", "claude-sonnet-4-6"},
			},
		},
	}
}

var (
	cfg     Config
	cfgMu   sync.RWMutex
	cfgPath string
)

func configFilePath() string {
	exe, err := os.Executable()
	if err != nil {
		return "config.json"
	}
	return filepath.Join(filepath.Dir(exe), "config.json")
}

func loadConfig() {
	cfgPath = configFilePath()
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		cfg = defaultConfig()
		saveConfig()
		return
	}
	c := defaultConfig()
	if err := json.Unmarshal(data, &c); err != nil {
		log.Printf("config parse error, using defaults: %v", err)
		cfg = defaultConfig()
		return
	}
	// 兼容旧配置：只有一个 upstream 时转为单路由
	if len(c.Routes) == 0 && c.Port == 0 {
		c.Port = 3000
	}
	cfg = c
}

func saveConfig() {
	data, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.WriteFile(cfgPath, data, 0644); err != nil {
		log.Printf("save config failed: %v", err)
	}
}

// matchRoute 查找请求模型匹配的路由。
func matchRoute(modelStr string) *Route {
	cfgMu.RLock()
	defer cfgMu.RUnlock()
	for i := range cfg.Routes {
		r := &cfg.Routes[i]
		for _, m := range r.MappedModels {
			if strings.EqualFold(modelStr, m) {
				return r
			}
		}
	}
	return nil
}

// replaceModel 检查请求体中的 model 字段，命中任意路由则替换为该路由的 target_model。
// 返回值：newBody, originalModel, matchedRoute
func replaceModel(body []byte) ([]byte, string, *Route) {
	if len(body) == 0 {
		return body, "", nil
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return body, "", nil
	}
	modelVal, ok := raw["model"]
	if !ok {
		return body, "", nil
	}
	var modelStr string
	if err := json.Unmarshal(modelVal, &modelStr); err != nil {
		return body, "", nil
	}
	route := matchRoute(modelStr)
	if route == nil {
		return body, "", nil
	}
	raw["model"], _ = json.Marshal(route.TargetModel)
	newBody, _ := json.Marshal(raw)
	return newBody, modelStr, route
}

var hopHeaders = map[string]bool{
	"Connection":          true,
	"Keep-Alive":          true,
	"Proxy-Authenticate":  true,
	"Proxy-Authorization": true,
	"Te":                  true,
	"Trailers":            true,
	"Transfer-Encoding":   true,
	"Upgrade":             true,
}

func copyHeaders(dst, src http.Header, skip ...string) {
	skipSet := make(map[string]bool, len(skip))
	for _, s := range skip {
		skipSet[http.CanonicalHeaderKey(s)] = true
	}
	for k, vv := range src {
		if hopHeaders[k] || skipSet[k] {
			continue
		}
		for _, v := range vv {
			dst.Add(k, v)
		}
	}
}

var client = &http.Client{
	Transport: &http.Transport{
		Proxy: http.ProxyFromEnvironment,
	},
}

func proxyHandler(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body failed", http.StatusBadRequest)
		return
	}

	newBody, originalModel, route := replaceModel(body)
	if originalModel != "" && route != nil {
		log.Printf("[proxy] model replaced: %s -> %s (route: %s)  path=%s",
			originalModel, route.TargetModel, route.UpstreamURL, r.URL.Path)
	}

	// 未匹配到任何路由，返回错误
	if route == nil {
		http.Error(w, "no route matched for model: "+originalModel, http.StatusBadRequest)
		return
	}

	upstreamBase := strings.TrimRight(route.UpstreamURL, "/")
	upstreamURL := upstreamBase + r.URL.RequestURI()

	req, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL, bytes.NewReader(newBody))
	if err != nil {
		http.Error(w, "build upstream request failed", http.StatusInternalServerError)
		return
	}

	// 透传客户端请求头（过滤 Host 和逐跳头）
	copyHeaders(req.Header, r.Header, "Host", "Authorization", "X-Api-Key", "Anthropic-Version")

	// 按协议设置鉴权头
	switch strings.ToLower(route.Protocol) {
	case "openai":
		req.Header.Set("Authorization", "Bearer "+route.UpstreamToken)
	default: // anthropic
		req.Header.Set("x-api-key", route.UpstreamToken)
		req.Header.Set("anthropic-version", "2023-06-01")
	}

	if req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Encoding", "identity")

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[proxy] upstream error: %v", err)
		http.Error(w, fmt.Sprintf("upstream error: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// 透传响应头
	copyHeaders(w.Header(), resp.Header)

	isSSE := strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream")
	if isSSE {
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
	}

	w.WriteHeader(resp.StatusCode)

	if isSSE {
		flusher, ok := w.(http.Flusher)
		buf := make([]byte, 32*1024)
		for {
			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				if _, writeErr := w.Write(buf[:n]); writeErr != nil {
					break
				}
				if ok {
					flusher.Flush()
				}
			}
			if readErr != nil {
				break
			}
		}
		return
	}

	if _, err := io.Copy(w, resp.Body); err != nil {
		log.Printf("[copy] response failed: %v", err)
	}
}

func handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	cfgMu.RLock()
	data, _ := json.Marshal(cfg)
	cfgMu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func handlePostConfig(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body failed", http.StatusBadRequest)
		return
	}
	var newCfg Config
	if err := json.Unmarshal(body, &newCfg); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	cfgMu.Lock()
	cfg = newCfg
	saveConfig()
	cfgMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func main() {
	loadConfig()

	mux := http.NewServeMux()

	// 精确匹配根路径
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexHTML)
	})

	// 配置 API
	mux.HandleFunc("GET /api/config", handleGetConfig)
	mux.HandleFunc("POST /api/config", handlePostConfig)

	// 代理：所有其他路径
	mux.HandleFunc("/", proxyHandler)

	addr := fmt.Sprintf(":%d", cfg.Port)
	mapped := make([]string, 0)
	for _, r := range cfg.Routes {
		mapped = append(mapped, fmt.Sprintf("%s->%s", r.MappedModels, r.TargetModel))
	}
	log.Printf("model-mapper listening on %s  routes=%v", addr, mapped)

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
