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
const voiceStreamType = "application/vnd.angry-boss.pcm"

func RegisterPracticeVoice(api *gin.RouterGroup, practice *game.Practice, workerURL string) {
	wavClient := &http.Client{Timeout: 8 * time.Second}
	streamClient := &http.Client{Timeout: 25 * time.Second}
	api.GET("/sessions/:id/voice/:line", func(ctx *gin.Context) {
		ctx.Header("Cache-Control", "no-store")
		ctx.Header("Vary", "Accept")
		state, err := practice.Get(ctx.Param("id"))
		if err != nil {
			writeSession(ctx, http.StatusOK, state, err)
			return
		}
		line := ctx.Param("line")
		text := state.BossCue(line)
		if index, err := strconv.Atoi(line); err == nil && index >= 0 && index < len(state.Messages) &&
			state.Messages[index].Role == "npc" {
			text = state.Messages[index].Text
		}
		if text == "" {
			ctx.Status(http.StatusNotFound)
			return
		}

		body, _ := json.Marshal(map[string]string{
			"scenarioId": state.ScenarioID,
			"text":       text,
		})
		request, err := http.NewRequestWithContext(ctx.Request.Context(), http.MethodPost, workerURL+"/speak", bytes.NewReader(body))
		if err != nil {
			ctx.Status(http.StatusBadGateway)
			return
		}
		request.Header.Set("Content-Type", "application/json")
		client := wavClient
		if ctx.GetHeader("Accept") == voiceStreamType {
			request.Header.Set("Accept", voiceStreamType)
			client = streamClient
		}
		response, err := client.Do(request)
		if err != nil {
			ctx.Status(http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		contentType := response.Header.Get("Content-Type")
		if response.StatusCode != http.StatusOK {
			ctx.Status(http.StatusBadGateway)
			return
		}
		if contentType == voiceStreamType && client == streamClient {
			ctx.Header("Content-Type", voiceStreamType)
			ctx.Header("X-Accel-Buffering", "no")
			forwardVoiceStream(ctx, response.Body)
			return
		}
		if contentType != "audio/wav" {
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

func forwardVoiceStream(ctx *gin.Context, body io.Reader) {
	source := io.LimitReader(body, maxVoiceBytes)
	buffer := make([]byte, 32*1024)
	for {
		n, readErr := source.Read(buffer)
		if n > 0 {
			if _, err := ctx.Writer.Write(buffer[:n]); err != nil {
				return
			}
			ctx.Writer.Flush()
		}
		if readErr != nil || ctx.Request.Context().Err() != nil {
			return
		}
	}
}
