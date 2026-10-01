export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

// What the API needs from an email provider; SMTP today, swappable.
export interface Mailer {
  // Rejects when the message was not accepted: callers must not treat that as sent.
  send(message: MailMessage): Promise<void>;
}
