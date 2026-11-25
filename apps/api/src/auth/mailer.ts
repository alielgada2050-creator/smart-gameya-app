/**
 * Sends sign-in codes by email over SMTP. Any SMTP service works; a Gmail or Google Workspace account with an
 * app password is free (smtp.gmail.com:465). Without SMTP settings nothing is sent: development shows the code
 * on screen instead, and production hides email sign-in.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { CONFIG, type AppConfig } from '../common/config.ts';

@Injectable()
export class Mailer {
  private readonly log = new Logger('Mailer');
  private readonly transport;
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    const s = config.smtp;
    this.transport = s ? nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass } }) : null;
  }
  get enabled() { return !!this.transport; }

  async sendCode(to: string, code: string, minutes: number) {
    if (!this.transport) return;
    const text = `رمز الدخول إلى جمعيتي: ${code}\nصالح ${minutes} دقائق. لا تشاركه مع أحد؛ فريق جمعيتي لن يطلبه منك.\n\nYour Jamiyati sign-in code: ${code} (valid ${minutes} minutes). Never share it.\n\nإن لم تطلب الرمز فتجاهل هذه الرسالة.`;
    const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#1b1b1b">
      <p>رمز الدخول إلى <b>جمعيتي</b>:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:12px 0" dir="ltr">${code}</p>
      <p>صالح ${minutes} دقائق. لا تشاركه مع أحد؛ فريق جمعيتي لن يطلبه منك.</p>
      <p style="color:#666;font-size:13px" dir="ltr">Your Jamiyati sign-in code (valid ${minutes} minutes). Never share it.</p>
      <p style="color:#666;font-size:13px">إن لم تطلب الرمز فتجاهل هذه الرسالة.</p></div>`;
    try {
      await this.transport.sendMail({ from: this.config.smtp!.from, to, subject: `رمز الدخول إلى جمعيتي: ${code}`, text, html });
    } catch (e: any) {
      this.log.error(`sending a sign-in code failed: ${e?.code ?? e?.message ?? e}`); // never log the code or the address
      throw e;
    }
  }
}
