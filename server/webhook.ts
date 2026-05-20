import type { AppSettings, EventLogEntry } from './types.js'

export async function sendWebhook(event: EventLogEntry, settings: AppSettings): Promise<void> {
  if (!settings.webhook.enabled || !settings.webhook.url)
    return

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (settings.webhook.secret)
    headers['X-Bambu-Monitor-Secret'] = settings.webhook.secret

  const response = await fetch(settings.webhook.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      event,
      sentAt: new Date().toISOString(),
    }),
  })

  if (!response.ok)
    throw new Error(`Webhook 返回 ${response.status}`)
}
