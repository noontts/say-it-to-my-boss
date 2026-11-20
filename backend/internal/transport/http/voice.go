package http

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"say-it-to-my-boss/backend/internal/game"
)

const maxVoiceBytes = 8 << 20

func RegisterPracticeVoice(api *gin.RouterGroup, practice *game.Practice, workerURL string) {
	client := &http.Client{Timeout: 25 * time.Second}
	api.GET("/sessions/:id/voice/:index", func(ctx *gin.Context) {
		ctx.Header("Cache-Control", "no-store")
		state, err := practice.Get(ctx.Param("id"))
		if err != nil {
			writeSession(ctx, http.StatusOK, state, err)
			return
		}
		index, err := strconv.Atoi(ctx.Param("index"))
		if err != nil || index < 0 || index >= len(state.Messages) ||
			state.Mode != "ai" || state.Messages[index].Role != "npc" {
			ctx.Status(http.StatusNotFound)
			return
		}

		body, err := json.Marshal(map[string]string{
			"scenarioId": state.ScenarioID,
			"text":       state.Messages[index].Text,
		})
		if err != nil {
			ctx.Status(http.StatusInternalServerError)
			return
		}
		request, err := http.NewRequestWithContext(ctx.Request.Context(), http.MethodPost, workerURL+"/speak", bytes.NewReader(body))
		if err != nil {
			ctx.Status(http.StatusBadGateway)
			return
		}
		request.Header.Set("Content-Type", "application/json")
		response, err := client.Do(request)
		if err != nil {
			ctx.Status(http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK || response.Header.Get("Content-Type") != "audio/wav" {
			ctx.Status(http.StatusBadGateway)
			return
		}
		audio, err := io.ReadAll(io.LimitReader(response.Body, maxVoiceBytes+1))
		if err != nil || len(audio) == 0 || len(audio) > maxVoiceBytes {
			ctx.Status(http.StatusBadGateway)
			return
		}
		ctx.Data(http.StatusOK, "audio/wav", audio)
	})
}
