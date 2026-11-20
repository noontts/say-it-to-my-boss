package main

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"say-it-to-my-boss/backend/internal/game"
	"say-it-to-my-boss/backend/internal/llm"
	transport "say-it-to-my-boss/backend/internal/transport/http"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	scenariosDir := os.Getenv("SCENARIOS_DIR")
	if scenariosDir == "" {
		scenariosDir = "../scenarios"
	}
	catalog, err := game.LoadCatalog(scenariosDir)
	if err != nil {
		log.Fatalf("Load scenarios: %v", err)
	}

	var ai game.PracticeAI
	mockAI := os.Getenv("MOCK_OPENROUTER") == "true"
	key := strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY"))
	model := strings.TrimSpace(os.Getenv("OPENROUTER_MODEL"))
	switch {
	case mockAI:
		ai = game.MockPracticeAI{}
		log.Print("Using simulated OpenRouter replies")
	case (key == "") != (model == ""):
		log.Fatal("Set both OPENROUTER_API_KEY and OPENROUTER_MODEL to enable AI practice")
	case key != "":
		ai = llm.NewOpenRouter(key, model)
	}

	router := gin.New()
	router.Use(gin.Recovery())
	router.GET("/health", func(ctx *gin.Context) { ctx.Status(http.StatusOK) })
	transport.RegisterScenarios(router.Group("/api"), catalog)
	api := router.Group("/api/v1")
	practice := game.NewPractice(catalog, ai)
	transport.RegisterPracticeScenarios(api, catalog)
	transport.RegisterPractice(api, practice)
	workerURL := strings.TrimRight(os.Getenv("TTS_BACKEND_URL"), "/")
	if workerURL == "" {
		workerURL = "http://127.0.0.1:8091"
	}
	transport.RegisterPracticeVoice(api, practice, workerURL)

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      35 * time.Second,
	}

	log.Printf("Listening on %s", server.Addr)
	log.Fatal(server.ListenAndServe())
}
