package main

import (
	"bytes"
	_ "embed"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
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

// setCorsHeaders 设置 CORS 响应头
func setCorsHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	w.Header().Set("Access-Control-Max-Age", "86400")
}

// handlePreflight 处理 CORS 预检请求
func handlePreflight(w http.ResponseWriter, _ *http.Request) {
	setCorsHeaders(w)
	w.WriteHeader(http.StatusNoContent)
}

// handleModels 返回模型列表（Office 插件需要）
func handleModels(w http.ResponseWriter, _ *http.Request) {
	setCorsHeaders(w)
	cfgMu.RLock()
	defer cfgMu.RUnlock()

	type ModelInfo struct {
		ID          string `json:"id"`
		Type        string `json:"type"`
		DisplayName string `json:"display_name"`
		CreatedAt   string `json:"created_at"`
	}

	models := make([]ModelInfo, 0)
	for _, route := range cfg.Routes {
		hostname := "unknown"
		if u, err := url.Parse(route.UpstreamURL); err == nil {
			hostname = u.Hostname()
		}
		for _, m := range route.MappedModels {
			models = append(models, ModelInfo{
				ID:          m,
				Type:        "model",
				DisplayName: fmt.Sprintf("%s (via %s)", route.TargetModel, hostname),
				CreatedAt:   "2026-01-01T00:00:00Z",
			})
		}
	}

	resp := map[string]interface{}{
		"data":      models,
		"first_id":  "",
		"has_more":  false,
		"last_id":   "",
	}
	if len(models) > 0 {
		resp["first_id"] = models[0].ID
		resp["last_id"] = models[len(models)-1].ID
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

func proxyHandler(w http.ResponseWriter, r *http.Request) {
	setCorsHeaders(w)

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
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"error":"unknown_model","message":"no route matched for model: `+originalModel+`"}`, http.StatusBadRequest)
		return
	}

	// Codex 用 /v1/models/responses，但中转只支持 /v1/responses
	upstreamPath := r.URL.RequestURI()
	if upstreamPath == "/v1/models/responses" {
		upstreamPath = "/v1/responses"
	}

	upstreamBase := strings.TrimRight(route.UpstreamURL, "/")
	if strings.HasSuffix(upstreamBase, "/v1") && strings.HasPrefix(upstreamPath, "/v1") {
		upstreamBase = strings.TrimSuffix(upstreamBase, "/v1")
	}
	upstreamURL := upstreamBase + upstreamPath

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

	// 透传响应头（过滤 CORS 头避免重复）
	for k, vv := range resp.Header {
		if !strings.HasPrefix(strings.ToLower(k), "access-control-") {
			w.Header()[k] = vv
		}
	}

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
	setCorsHeaders(w)
	cfgMu.RLock()
	data, _ := json.Marshal(cfg)
	cfgMu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func handlePostConfig(w http.ResponseWriter, r *http.Request) {
	setCorsHeaders(w)
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

// generateSelfSignedCert 生成自签名 HTTPS 证书
func generateSelfSignedCert(certPath, keyPath string) (tls.Certificate, error) {
	// 检查证书是否已存在
	if _, err := os.Stat(certPath); err == nil {
		if _, err := os.Stat(keyPath); err == nil {
			cert, err := tls.LoadX509KeyPair(certPath, keyPath)
			if err == nil {
				return cert, nil
			}
		}
	}

	// 生成新证书
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return tls.Certificate{}, err
	}

	serialNumber, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName: "localhost",
		},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{{127, 0, 0, 1}},
	}

	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return tls.Certificate{}, err
	}

	// 保存证书
	certPEM := bytes.Buffer{}
	certPEM.Write(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER}))

	keyPEM := bytes.Buffer{}
	privBytes, _ := x509.MarshalPKCS1PrivateKey(priv)
	keyPEM.Write(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: privBytes}))

	os.WriteFile(certPath, certPEM.Bytes(), 0644)
	os.WriteFile(keyPath, keyPEM.Bytes(), 0600)

	log.Printf("Generated self-signed cert: %s", certPath)
	return tls.X509KeyPair(certPEM.Bytes(), keyPEM.Bytes())
}

func getScriptDir() string {
	if len(os.Args) > 0 && os.Args[0] != "" {
		dir := filepath.Dir(os.Args[0])
		if filepath.IsAbs(dir) {
			return dir
		}
	}
	return "."
}

func main() {
	loadConfig()

	scriptDir := getScriptDir()
	certPath := filepath.Join(scriptDir, "localhost-cert.pem")
	keyPath := filepath.Join(scriptDir, "localhost-key.pem")

	// 生成自签名证书
	cert, err := generateSelfSignedCert(certPath, keyPath)
	if err != nil {
		log.Fatalf("failed to generate cert: %v", err)
	}

	// 打印路由表
	cfgMu.RLock()
	for i, r := range cfg.Routes {
		log.Printf("  [%d] %v -> %s (%s)", i+1, r.MappedModels, r.TargetModel, r.UpstreamURL)
	}
	cfgMu.RUnlock()

	mux := http.NewServeMux()

	// CORS 预检
	mux.HandleFunc("OPTIONS /", handlePreflight)

	// Web 界面
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexHTML)
	})

	// 模型列表（Office 插件需要）
	mux.HandleFunc("GET /v1/models", handleModels)

	// 配置 API
	mux.HandleFunc("GET /api/config", handleGetConfig)
	mux.HandleFunc("POST /api/config", handlePostConfig)

	// 代理：所有其他路径
	mux.HandleFunc("/", proxyHandler)

	httpPort := cfg.Port
	httpsPort := httpPort + 1

	// HTTP 服务器（Claude Desktop）
	go func() {
		addr := fmt.Sprintf(":%d", httpPort)
		log.Printf("HTTP server listening on %s (Claude Desktop)", addr)
		if err := http.ListenAndServe(addr, mux); err != nil {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// HTTPS 服务器（Office 插件）
	httpsMux := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// OPTIONS 需要特殊处理
		if r.Method == "OPTIONS" {
			handlePreflight(w, r)
			return
		}
		// 其他请求走主处理器
		mux.ServeHTTP(w, r)
	})

	tlsConfig := &tls.Config{Certificates: []tls.Certificate{cert}}
	httpsServer := &http.Server{
		Addr:      fmt.Sprintf(":%d", httpsPort),
		Handler:  httpsMux,
		TLSConfig: tlsConfig,
	}

	log.Printf("HTTPS server listening on :%d (Office 插件)", httpsPort)
	if err := httpsServer.ListenAndServeTLS("", ""); err != nil {
		log.Fatalf("HTTPS server error: %v", err)
	}
}