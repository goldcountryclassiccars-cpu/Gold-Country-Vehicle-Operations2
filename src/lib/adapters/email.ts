/**
 * Email abstraction. Development uses the "log" adapter, which records
 * messages (safely, without sending anything) so flows can be demonstrated
 * and tested. A production SMTP adapter can be wired in without touching
 * callers. Notification content is permission-filtered BEFORE reaching here.
 */
import { config } from "@/lib/config";

export interface EmailAttachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>;
}

/** Development adapter: logs a redacted line; never sends. */
export class LogEmailAdapter implements EmailAdapter {
  /** What would have gone out, for tests and the practice-mode badge. */
  readonly sent: { to: string; subject: string; attachments: number }[] = [];
  async send(message: EmailMessage) {
    // Do not log message bodies — they may reference records; subject + recipient
    // is enough to demonstrate delivery in development.
    this.sent.push({ to: message.to, subject: message.subject, attachments: message.attachments?.length ?? 0 });
    console.log(`[email:dev] to=${message.to} subject="${message.subject}" (not sent — log adapter)`);
  }
}

class SmtpEmailAdapter implements EmailAdapter {
  async send(): Promise<void> {
    throw new Error("SMTP adapter not configured. Set EMAIL_ADAPTER=log for development.");
  }
}

let adapter: EmailAdapter | null = null;
export function email(): EmailAdapter {
  if (!adapter) {
    adapter = config().EMAIL_ADAPTER === "log" ? new LogEmailAdapter() : new SmtpEmailAdapter();
  }
  return adapter;
}

/** True when email is the development log adapter — nothing reaches a customer. */
export function emailIsPracticeMode() {
  return config().EMAIL_ADAPTER === "log";
}

/** Tests: swap the adapter (pass null to restore the configured one). */
export function setEmailAdapterForTests(next: EmailAdapter | null) {
  adapter = next;
}
