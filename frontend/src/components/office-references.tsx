const officeReferences = [
  {
    id: 'report',
    title: 'รายงาน',
    facts: [
      'บทสรุปและกราฟภาพรวมพร้อมแล้ว หัวหน้าสามารถใช้เตรียมประชุมได้',
      'ตัวเลขจากทีมปฏิบัติการชุดล่าสุดยังอยู่ระหว่างตรวจสอบก่อนรวมเข้ารายงานฉบับเต็ม',
    ],
  },
  {
    id: 'team-notes',
    title: 'โน้ตทีม',
    facts: [
      'ส่งบทสรุปและกราฟภาพรวมได้วันนี้ 17:00 น.',
      'ถ้าการตรวจตัวเลขยังติดขัด ให้อัปเดตความเสี่ยงกับหัวหน้าภายใน 19:00 น. วันนี้',
      'ทีมยืนยันว่าจะส่งรายงานฉบับเต็มได้พรุ่งนี้ 08:00 น. ก่อนประชุม',
    ],
  },
]

export function CallReferences() {
  return (
    <details className="call-references">
      <summary>เอกสารประกอบ</summary>
      <div className="reference-grid">
        {officeReferences.map((reference) => (
          <section key={reference.id}>
            <h2>{reference.title}</h2>
            <ul>{reference.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
          </section>
        ))}
      </div>
    </details>
  )
}
