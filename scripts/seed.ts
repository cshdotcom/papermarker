import { db } from '../src/lib/db'
import { ensureDemoUser } from '../src/lib/auth'
import { ensureStorageDirs, processedDir, relPath } from '../src/lib/storage'
import { getImageSize, persistGrade, syntheticResult } from '../src/lib/ai-gateway'
import { generateTaskPdfs } from '../src/lib/pdf-render'
import sharp from 'sharp'
import path from 'path'

const W = 1000
const H = 1414

function buildPaperSvg(pageNo: number): string {
  const questions =
    pageNo === 1
      ? [
          { y: 0.08, h: 0.1, n: 1, text: '计算 12 + 17 = ?', ans: '29' },
          { y: 0.2, h: 0.12, n: 2, text: '解方程 2x + 6 = 14', ans: 'x = 8 (学生作答)' },
          { y: 0.34, h: 0.1, n: 3, text: '化简 a(b + c)', ans: 'ab + c (学生作答)' },
          { y: 0.46, h: 0.12, n: 4, text: '求三角形面积（底6高4）', ans: '12' },
        ]
      : [
          { y: 0.08, h: 0.14, n: 5, text: '应用题：路程计算', ans: '120km / 2h = 60' },
          { y: 0.26, h: 0.16, n: 6, text: '几何证明题', ans: '（证明过程）' },
          { y: 0.46, h: 0.1, n: 7, text: '计算 25 × 4 = ?', ans: '100' },
        ]

  let body = `<text x="60" y="60" font-size="34" font-weight="700" fill="#111">数学单元测验</text>`
  body += `<text x="820" y="55" font-size="22" fill="#888">第 ${pageNo} 页</text>`
  body += `<text x="60" y="92" font-size="16" fill="#666">姓名：________  班级：____  得分：______</text>`
  body += `<line x1="60" y1="108" x2="940" y2="108" stroke="#999" stroke-width="1"/>`

  for (const q of questions) {
    const yTop = q.y * H
    const yMid = yTop + q.h * H * 0.35
    body += `<text x="60" y="${yMid}" font-size="18" font-weight="600" fill="#111">第${q.n}题</text>`
    body += `<text x="130" y="${yMid}" font-size="18" fill="#111">${q.text}</text>`
    body += `<text x="130" y="${yMid + 28}" font-size="16" fill="#1f6feb">作答：${q.ans}</text>`
    const lineY = yTop + q.h * H * 0.7
    for (let i = 0; i < 3; i++) {
      body += `<line x1="130" y1="${lineY + i * 22}" x2="900" y2="${lineY + i * 22}" stroke="#ccc" stroke-width="1"/>`
    }
  }

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    ${body}
  </svg>`
}

async function main() {
  ensureStorageDirs()
  const user = await ensureDemoUser()

  // 删除旧 demo 任务
  const old = await db.task.findMany({ where: { userId: user.id, paperName: '数学单元测验' } })
  for (const t of old) await db.task.delete({ where: { id: t.id } })

  // 生成两页示例试卷图片
  const pagePaths: string[] = []
  for (let p = 1; p <= 2; p++) {
    const imgPath = path.join(processedDir(), `demo-paper-p${p}.jpg`)
    await sharp(Buffer.from(buildPaperSvg(p))).jpeg({ quality: 90 }).toFile(imgPath)
    pagePaths.push(imgPath)
  }

  const dims = await Promise.all(pagePaths.map((p) => getImageSize(p)))

  const task = await db.task.create({
    data: {
      userId: user.id,
      paperName: '数学单元测验',
      studentName: '示例·李同学',
      reviewStatus: 'pending_review',
      printStatus: 'idle',
      parseMode: 'auto_ask',
      answerMode: 'auto_ask',
      totalGet: 0,
      totalFull: 0,
      imgWidth: dims[0].w,
      imgHeight: dims[0].h,
      files: {
        create: pagePaths.map((p, i) => ({
          fileType: 'origin',
          filePath: relPath(p),
          pageNo: i + 1,
          width: dims[i].w,
          height: dims[i].h,
        })),
      },
    },
  })

  // 多页合成批改结果（题目均匀分布到两页）
  const result = syntheticResult(2)
  await persistGrade(task.id, result)
  await generateTaskPdfs(task.id)

  console.log('Seed 完成（2 页示例任务）, taskId =', task.id)
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
