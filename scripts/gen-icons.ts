import sharp from 'sharp'

const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="104" fill="#059669"/>
  <path d="M148 118 h216 v190 l-74 86 h-142 z" fill="none" stroke="#ffffff" stroke-width="26" stroke-linejoin="round"/>
  <path d="M364 308 h-74 v86 z" fill="#ffffff" opacity="0.92"/>
  <path d="M188 236 l34 36 78-84" stroke="#ffffff" stroke-width="26" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

async function main() {
  await sharp(Buffer.from(svg)).png().toFile('public/icon-512.png')
  await sharp(Buffer.from(svg)).resize(192, 192).png().toFile('public/icon-192.png')
  console.log('icons generated')
}

main()
