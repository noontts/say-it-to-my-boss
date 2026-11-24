package http

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"say-it-to-my-boss/backend/internal/game"
)

func RegisterPractice(api *gin.RouterGroup, practice *game.Practice) {
	api.Use(func(ctx *gin.Context) {
		ctx.Header("Cache-Control", "no-store")
		ctx.Next()
	})
	api.POST("/sessions", func(ctx *gin.Context) {
		var input struct {
			ScenarioID  string          `json:"scenarioId"`
			OfficeEntry json.RawMessage `json:"officeEntry"`
		}
		if !readJSON(ctx, &input) || input.ScenarioID == "" {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid scenario"})
			return
		}
		officeEntry := ""
		if input.OfficeEntry != nil {
			if json.Unmarshal(input.OfficeEntry, &officeEntry) != nil || officeEntry == "" {
				ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid office entry"})
				return
			}
		}
		state, err := practice.StartWithOfficeEntry(input.ScenarioID, officeEntry)
		writeSession(ctx, http.StatusCreated, state, err)
	})
	api.GET("/sessions/:id", func(ctx *gin.Context) {
		state, err := practice.Get(ctx.Param("id"))
		writeSession(ctx, http.StatusOK, state, err)
	})
	api.POST("/sessions/:id/messages", func(ctx *gin.Context) {
		var input game.SubmitInput
		input.Turn = -1
		if !readJSON(ctx, &input) {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid message"})
			return
		}
		state, err := practice.Submit(ctx.Request.Context(), ctx.Param("id"), input)
		writeSession(ctx, http.StatusOK, state, err)
	})
	api.POST("/sessions/:id/finish", func(ctx *gin.Context) {
		state, err := practice.Finish(ctx.Request.Context(), ctx.Param("id"))
		writeSession(ctx, http.StatusOK, state, err)
	})
	api.POST("/sessions/:id/hang-up", func(ctx *gin.Context) {
		var input struct {
			Turn   *int   `json:"turn"`
			Reason string `json:"reason"`
		}
		if !readJSON(ctx, &input) ||
			!(input.Turn != nil && input.Reason == "" || input.Turn == nil && input.Reason == "player") {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid turn"})
			return
		}
		state, err := practice.EndCall(ctx.Param("id"), input.Turn)
		writeSession(ctx, http.StatusOK, state, err)
	})
}

func readJSON(ctx *gin.Context, target any) bool {
	ctx.Request.Body = http.MaxBytesReader(ctx.Writer, ctx.Request.Body, 8192)
	decoder := json.NewDecoder(ctx.Request.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(target) == nil && decoder.Decode(new(json.RawMessage)) == io.EOF
}

func writeSession(ctx *gin.Context, status int, state game.Session, err error) {
	if err == nil {
		ctx.JSON(status, state)
		return
	}
	switch {
	case errors.Is(err, game.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, game.ErrInvalidOfficeEntry):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid office entry"})
	case errors.Is(err, game.ErrInvalidTurn), errors.Is(err, game.ErrNotPlayable):
		status = http.StatusBadRequest
	case errors.Is(err, game.ErrConflict):
		status = http.StatusConflict
	case errors.Is(err, game.ErrAtCapacity):
		status = http.StatusServiceUnavailable
	case errors.Is(err, game.ErrReplyFailed), errors.Is(err, game.ErrEvaluationFailed):
		status = http.StatusBadGateway
	default:
		status = http.StatusInternalServerError
	}
	ctx.JSON(status, gin.H{"error": http.StatusText(status)})
}
