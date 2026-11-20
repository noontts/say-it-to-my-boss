package llm

const npcReplySchema = `{
  "name": "npc_reply",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "endCall": {"type": "boolean"},
      "reply": {"type": "string"},
      "trustDelta": {"type": "integer", "minimum": -20, "maximum": 20},
      "achieved": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["endCall", "reply", "trustDelta", "achieved"],
    "additionalProperties": false
  }
}`

const coachingSchema = `{
  "name": "coaching",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "scores": {
        "type": "object",
        "properties": {
          "clarity": {"type": "integer", "minimum": 0, "maximum": 100},
          "empathy": {"type": "integer", "minimum": 0, "maximum": 100},
          "professionalism": {"type": "integer", "minimum": 0, "maximum": 100},
          "problemSolving": {"type": "integer", "minimum": 0, "maximum": 100}
        },
        "required": ["clarity", "empathy", "professionalism", "problemSolving"],
        "additionalProperties": false
      },
      "strengths": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
      "suggestions": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 3},
      "summary": {"type": "string"}
    },
    "required": ["scores", "strengths", "suggestions", "summary"],
    "additionalProperties": false
  }
}`
