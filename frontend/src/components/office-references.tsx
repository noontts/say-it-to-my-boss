import { notesPosition, reportPosition, type Point } from './office-scene'

export type OfficeReference = {
  id: string
  title: string
  action: string
  position: Point
  facts: string[]
}

export const officeReferences: OfficeReference[] = [
  {
    id: 'report',
    title: 'รายงาน',
    action: 'อ่านรายงาน',
    position: reportPosition,
    facts: [
      'บทสรุปและกราฟภาพรวมพร้อมแล้ว หัวหน้าสามารถใช้เตรียมประชุมได้',
      'ตัวเลขจากทีมปฏิบัติการชุดล่าสุดยังอยู่ระหว่างตรวจสอบก่อนรวมเข้ารายงานฉบับเต็ม',
    ],
  },
  {
    id: 'team-notes',
    title: 'โน้ตทีม',
    action: 'อ่านโน้ตทีม',
    position: notesPosition,
    facts: [
      'ส่งบทสรุปและกราฟภาพรวมได้วันนี้ 17:00 น.',
      'ถ้าการตรวจตัวเลขยังติดขัด ให้อัปเดตความเสี่ยงกับหัวหน้าภายใน 19:00 น. วันนี้',
      'ทีมยืนยันว่าจะส่งรายงานฉบับเต็มได้พรุ่งนี้ 08:00 น. ก่อนประชุม',
    ],
  },
]

export function ReferenceFacts({ reference }: { reference: OfficeReference }) {
  return <ul>{reference.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
}

export function CallReferences() {
  return (
    <details className="call-references">
      <summary>เอกสารประกอบ</summary>
      <div className="reference-grid">
        {officeReferences.map((reference) => (
          <section key={reference.id}>
            <h4>{reference.title}</h4>
            <ReferenceFacts reference={reference} />
          </section>
        ))}
      </div>
    </details>
  )
}
