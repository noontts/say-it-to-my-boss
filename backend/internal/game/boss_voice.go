package game

const bossReminder = "ทำไมยังไม่ตอบครับ?"

// BossCue returns dialogue for a transient line triggered by the call UI.
func (s Session) BossCue(name string) string {
	if s.ScenarioID != "angry-boss" || s.Status != "active" {
		return ""
	}
	switch name {
	case "interjection":
		return "ขอเข้าประเด็นเลยครับ"
	case "takeover":
		return "เดี๋ยวครับ ฟังผมก่อน ขอคำตอบสั้น ๆ ให้ตรงคำถามครับ"
	case "reminder":
		return bossReminder
	default:
		return ""
	}
}
