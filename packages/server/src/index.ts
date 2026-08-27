/** 转发器的启动入口。逻辑全在 relayServer.ts 里。 */

import { createRelayServer } from './relayServer'

const PORT = Number(process.env.PORT ?? 3001)

createRelayServer().listen(PORT)
console.log(`[ai-duel] 转发器已启动：http://localhost:${PORT}`)
