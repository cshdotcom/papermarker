import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

async function main() {
  try {
    const zai = await ZAI.create()
    // 用一个简单的纯文字请求先测试 SDK 是否可用
    const r: any = await (zai as any).chat.completions.create({
      messages: [{ role: 'user', content: '回复两个字：你好' }],
    })
    console.log('TEXT OK:', r.choices?.[0]?.message?.content?.slice(0, 80))
  } catch (e: any) {
    console.log('TEXT FAIL:', e?.message || e)
  }

  // 测试 VLM（用本地上传生成的试卷图）
  try {
    const zai = await ZAI.create()
    const buf = fs.readFileSync('/tmp/test-paper.jpg')
    const b64 = buf.toString('base64')
    const r: any = await (zai as any).chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '这张试卷里有哪些题目？只返回 JSON 数组，每个元素含 questionText 字段。' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })
    console.log('VLM OK:', String(r.choices?.[0]?.message?.content).slice(0, 200))
  } catch (e: any) {
    console.log('VLM FAIL:', e?.message || e)
  }
}

main()
