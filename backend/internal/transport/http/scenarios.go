package http

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"say-it-to-my-boss/backend/internal/game"
)

func RegisterScenarios(api *gin.RouterGroup, catalog *game.Catalog) {
	registerScenarios(api, catalog, catalog.List, false)
}

func RegisterPracticeScenarios(api *gin.RouterGroup, catalog *game.Catalog) {
	registerScenarios(api, catalog, catalog.ListPractice, true)
}

func registerScenarios(api *gin.RouterGroup, catalog *game.Catalog, list func() []game.Summary, practice bool) {
	api.GET("/scenarios", func(ctx *gin.Context) {
		ctx.JSON(http.StatusOK, gin.H{"scenarios": list()})
	})
	api.GET("/scenarios/:id", func(ctx *gin.Context) {
		scenario, exists := catalog.Get(ctx.Param("id"))
		if !exists {
			ctx.JSON(http.StatusNotFound, gin.H{"error": "scenario not found"})
			return
		}
		if practice {
			scenario.Playable = scenario.Practice != nil
			ctx.JSON(http.StatusOK, scenario.Summary)
			return
		}
		ctx.JSON(http.StatusOK, scenario)
	})
}
