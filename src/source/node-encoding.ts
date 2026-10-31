import iconv from 'iconv-lite'

import { registerGb18030Codec } from './encoding.js'

registerGb18030Codec({
  decode(bytes: Uint8Array): string {
    return iconv.decode(Buffer.from(bytes), 'gb18030')
  },
  encode(text: string): Uint8Array {
    return new Uint8Array(iconv.encode(text, 'gb18030'))
  },
})

export { registerGb18030Codec }
