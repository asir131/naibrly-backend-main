const nodemailer = require("nodemailer");

class EmailService {
  constructor() {
    this.isInitialized = true;
    this.serviceName = "SMTP";

    const host = process.env.EMAIL_HOST;
    const port = Number(process.env.EMAIL_PORT) || 587;
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });

    console.log("SMTP email service initialized");
  }

  async sendOTPEmail(email, otp, userName) {
    try {
      console.log(`Attempting to send OTP email to: ${email}`);
      console.log(`OTP: ${otp} for user: ${userName}`);

      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: email,
        subject: "Password Reset OTP - Naibrly",
        html: this.getOTPEmailTemplate(otp, userName),
      });

      console.log("Email sent via SMTP", { messageId: info.messageId });

      return {
        success: true,
        messageId: info.messageId,
        service: "SMTP",
        message: "OTP sent successfully to your email",
      };
    } catch (error) {
      console.error("SMTP error sending OTP:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async sendPasswordResetSuccessEmail(email, userName) {
    try {
      console.log(`Attempting to send success email to: ${email}`);

      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: email,
        subject: "Password Reset Successful - Naibrly",
        html: this.getSuccessEmailTemplate(userName),
      });

      console.log("Success email sent via SMTP", { messageId: info.messageId });
      return {
        success: true,
        messageId: info.messageId,
        service: "SMTP",
      };
    } catch (error) {
      console.error("Error sending success email via SMTP:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  getOTPEmailTemplate(otp, userName) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <style>
              body { 
                  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                  background-color: #f7fafc; 
                  margin: 0; 
                  padding: 0; 
              }
              .container { 
                  max-width: 600px; 
                  margin: 0 auto; 
                  background: white; 
                  padding: 40px; 
                  border-radius: 12px; 
                  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); 
                  border: 1px solid #e2e8f0;
              }
              .header { 
                  text-align: center; 
                  color: #1a202c; 
                  margin-bottom: 30px;
              }
              .logo { 
                  font-size: 24px; 
                  font-weight: bold; 
                  color: #2563eb; 
                  margin-bottom: 10px;
              }
              .otp-code { 
                  font-size: 42px; 
                  font-weight: bold; 
                  text-align: center; 
                  color: #2563eb; 
                  margin: 30px 0; 
                  padding: 20px; 
                  background: #f8fafc; 
                  border-radius: 8px; 
                  letter-spacing: 8px; 
                  border: 2px dashed #cbd5e0;
              }
              .info { 
                  color: #4a5568; 
                  line-height: 1.6; 
                  font-size: 16px;
                  margin-bottom: 20px;
              }
              .warning { 
                  background: #fffaf0; 
                  padding: 15px; 
                  border-radius: 6px; 
                  border-left: 4px solid #dd6b20; 
                  margin: 20px 0;
              }
              .footer { 
                  margin-top: 40px; 
                  text-align: center; 
                  color: #718096; 
                  font-size: 14px; 
                  border-top: 1px solid #e2e8f0;
                  padding-top: 20px;
              }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <div class="logo">Naibrly</div>
                  <h2>Password Reset Request</h2>
              </div>
              
              <p class="info">Hello <strong>${userName}</strong>,</p>
              
              <p class="info">You requested to reset your password for your Naibrly account. Use the following verification code to proceed:</p>
              
              <div class="otp-code">${otp}</div>
              
              <p class="info">This OTP is valid for <strong>${
                process.env.OTP_EXPIRY_MINUTES || 10
              } minutes</strong>.</p>
              
              <div class="warning">
                  <strong>Security Tip:</strong> Never share this code with anyone. Naibrly will never ask for your password or verification code.
              </div>
              
              <p class="info">If you didn't request this password reset, please ignore this email or contact our support team if you're concerned about your account's security.</p>
              
              <div class="footer">
                  <p><strong>Naibrly Team</strong></p>
                  <p>This is an automated message, please do not reply directly to this email.</p>
                  <p>If you need help, contact our support team.</p>
              </div>
          </div>
      </body>
      </html>
    `;
  }

  getSuccessEmailTemplate(userName) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <style>
              body { 
                  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                  background-color: #f0f9ff; 
                  margin: 0; 
                  padding: 0; 
              }
              .container { 
                  max-width: 600px; 
                  margin: 0 auto; 
                  background: white; 
                  padding: 40px; 
                  border-radius: 12px; 
                  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); 
                  border: 1px solid #e2e8f0;
              }
              .header { 
                  text-align: center; 
                  color: #1a202c; 
                  margin-bottom: 20px;
              }
              .logo { 
                  font-size: 24px; 
                  font-weight: bold; 
                  color: #2563eb; 
                  margin-bottom: 10px;
              }
              .message { 
                  color: #2d3748; 
                  line-height: 1.6; 
                  font-size: 16px;
                  margin-bottom: 20px;
              }
              .footer { 
                  margin-top: 30px; 
                  text-align: center; 
                  color: #718096; 
                  font-size: 14px; 
                  border-top: 1px solid #e2e8f0;
                  padding-top: 20px;
              }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <div class="logo">Naibrly</div>
                  <h2>Password Reset Successful</h2>
              </div>
              
              <p class="message">Hello <strong>${userName}</strong>,</p>
              
              <p class="message">This is a confirmation that your password has been successfully reset. If you did not perform this action, please contact our support team immediately.</p>
              
              <p class="message">Thank you for using Naibrly. We're here to help if you need anything.</p>
              
              <div class="footer">
                  <p><strong>Naibrly Team</strong></p>
                  <p>This is an automated message, please do not reply directly to this email.</p>
                  <p>If you need help, contact our support team.</p>
              </div>
          </div>
      </body>
      </html>
    `;
  }
}

module.exports = new EmailService();
