import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'

const client = createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096' })

async function main() {
  console.log('=== Testing SDK ===')

  try {
    console.log('\n--- session.list ---')
    const listResult = await client.session.list({ directory: '/mnt/c/Dysphagia' })
    console.log('typeof result:', typeof listResult)
    console.log('result keys:', Object.keys(listResult))
    console.log('result.data type:', typeof listResult.data)
    console.log('result.data:', JSON.stringify(listResult.data, null, 2)?.slice(0, 1000))
    if (listResult.error) {
      console.log('result.error:', JSON.stringify(listResult.error, null, 2)?.slice(0, 500))
    }
  } catch (e) {
    console.log('list error:', e)
  }

  try {
    console.log('\n--- session.create ---')
    const createResult = await client.session.create({ directory: '/mnt/c/Dysphagia', title: 'Debug Test' })
    console.log('typeof result:', typeof createResult)
    console.log('result keys:', Object.keys(createResult))
    console.log('result.data type:', typeof createResult.data)
    console.log('result.data:', JSON.stringify(createResult.data, null, 2)?.slice(0, 1000))
    if (createResult.error) {
      console.log('result.error:', JSON.stringify(createResult.error, null, 2)?.slice(0, 500))
    }
  } catch (e) {
    console.log('create error:', e)
  }

  try {
    console.log('\n--- global.health ---')
    const healthResult = await client.global.health()
    console.log('health result:', JSON.stringify(healthResult, null, 2)?.slice(0, 500))
  } catch (e) {
    console.log('health error:', e)
  }
}

main()
