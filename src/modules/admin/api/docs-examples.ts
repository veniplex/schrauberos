/**
 * Codebeispiele der Doku-Seite (Platzhalter, nie echte Geheimnisse). Der Node-Prüfcode wird in `docs.test.ts` ausgeführt und gegen die Signatur der Anwendung geprüft – die Beispiele
 * sind **Referenzcode**, kein Text, der veralten kann.
 */
export const NODE_VERIFY = `import { createHmac, timingSafeEqual } from "node:crypto";

// secrets: das Geheimnis des Webhooks (während einer Rotation beide, neues zuerst)
// headers: Kopfzeilen mit kleingeschriebenen Namen; rawBody: der unveränderte Text der Anfrage
export function verifyWebhook(secrets, headers, rawBody) {
  const timestamp = headers["x-webhook-timestamp"] ?? "";
  const id = headers["x-webhook-id"] ?? "";
  const signature = headers["x-webhook-signature"] ?? "";
  if (!/^\\d{1,12}$/.test(timestamp)) return false;
  // Wiederholungsschutz: nur Zeitstempel im Fenster von 5 Minuten
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const given = signature.split(",").map((part) => part.trim()).filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(\`\${timestamp}.\${id}.\${rawBody}\`).digest();
    for (const candidate of given) {
      const bytes = Buffer.from(candidate, "hex");
      if (bytes.length === expected.length && timingSafeEqual(bytes, expected)) return true;
    }
  }
  return false;
}
// Danach die Ereignis-ID (Kopf X-Webhook-Id) merken und Doppeltes ignorieren: Die Zustellung ist „mindestens einmal“.`;

export const PYTHON_VERIFY = `import hashlib
import hmac
import time


def verify_webhook(secrets, headers, raw_body: bytes) -> bool:
    timestamp = headers.get("X-Webhook-Timestamp", "")
    event_id = headers.get("X-Webhook-Id", "")
    signature = headers.get("X-Webhook-Signature", "")
    # Wiederholungsschutz: nur Zeitstempel im Fenster von 5 Minuten
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        return False
    given = [part.strip()[3:] for part in signature.split(",") if part.strip().startswith("v1=")]
    message = f"{timestamp}.{event_id}.".encode() + raw_body
    for secret in secrets:
        expected = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
        if any(hmac.compare_digest(expected, candidate) for candidate in given):
            return True
    return False
`;

export const PHP_VERIFY = `<?php
function verify_webhook(array $secrets, array $headers, string $rawBody): bool {
    $timestamp = $headers['X-Webhook-Timestamp'] ?? '';
    $id = $headers['X-Webhook-Id'] ?? '';
    $signature = $headers['X-Webhook-Signature'] ?? '';
    // Wiederholungsschutz: nur Zeitstempel im Fenster von 5 Minuten
    if (!ctype_digit($timestamp) || abs(time() - (int) $timestamp) > 300) return false;
    $given = [];
    foreach (explode(',', $signature) as $part) {
        $part = trim($part);
        if (str_starts_with($part, 'v1=')) $given[] = substr($part, 3);
    }
    foreach ($secrets as $secret) {
        $expected = hash_hmac('sha256', "$timestamp.$id.$rawBody", $secret);
        foreach ($given as $candidate) {
            if (hash_equals($expected, $candidate)) return true;
        }
    }
    return false;
}
`;

export const WEBHOOK_REQUEST_EXAMPLE = `POST /hooks/schrauberos HTTP/1.1
Content-Type: application/json
User-Agent: SchrauberOS-Webhook/1
X-Webhook-Id: clx0example0event0id
X-Webhook-Timestamp: 1767225600
X-Webhook-Event: order.closed
X-Webhook-Signature: v1=3f7a…

{"id":"clx0example0event0id","type":"order.closed","createdAt":"2026-01-01T00:00:00.000Z","entity":{"resource":"orders","id":"clx0example0order0id"}}`;

export const FETCH_AFTER_EVENT = `# Das Ereignis nennt nur die Ressource und die ID – die Daten holt der Empfänger mit seinem eigenen Token:
curl -H "Authorization: Bearer <TOKEN>" \\
  "<BASE_URL>/api/v1/orders/clx0example0order0id"`;

export const UPLOAD_EXAMPLE = `# Upload (multipart/form-data): Felder der Ressource plus die Datei im Feld "file"
curl -X POST "<BASE_URL>/api/v1/files" \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -F "ownerType=order" -F "ownerId=<id>" -F "category=photo" \\
  -F "file=@foto.jpg"`;

export const DOWNLOAD_EXAMPLE = `# Download: die Antwort ist die Datei selbst (Content-Type und Content-Disposition stehen im Kopf)
curl -L -o beleg.pdf -H "Authorization: Bearer <TOKEN>" \\
  "<BASE_URL>/api/v1/files/<id>/content"`;

export const ERROR_EXAMPLE = `HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{"type":"…/validation_failed","title":"Validation failed","status":422,"code":"validation_failed","detail":"…","fields":{"name":{"code":"validation.required"}}}`;

export const PAGING_EXAMPLE = `GET /api/v1/customers?page=2&limit=50&sort=-name,city&q=meier

{"data":[ … ],"page":{"number":2,"limit":50,"total":183,"pages":4}}`;
