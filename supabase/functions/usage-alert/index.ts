import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface UsageAlertRequest {
  userId: string;
  email: string;
  plan: "free" | "pro" | "premium";
  used: number;
  limit: number;
  percent: number;
  threshold: 80 | 100;
}

interface AlertLog {
  id: string;
  user_id: string;
  threshold: number;
  month_year: string; // "2025-01"
  sent_at: string;
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get environment variables
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("FROM_EMAIL");
    const appBaseUrl = Deno.env.get("APP_BASE_URL");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!fromEmail) {
      return new Response(JSON.stringify({ error: "FROM_EMAIL not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body
    const {
      userId,
      email,
      plan,
      used,
      limit,
      percent,
      threshold,
    }: UsageAlertRequest = await req.json();

    // Validate required fields
    if (!userId || !email || !plan || used === undefined || limit === undefined || percent === undefined || !threshold) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate threshold
    if (threshold !== 80 && threshold !== 100) {
      return new Response(JSON.stringify({ error: "Threshold must be 80 or 100" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate plan
    if (!["free", "pro", "premium"].includes(plan)) {
      return new Response(JSON.stringify({ error: "Invalid plan tier" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine which email to send based on percent
    let actualThreshold: 80 | 100;
    if (percent >= 100) {
      actualThreshold = 100;
    } else if (percent >= 80) {
      actualThreshold = 80;
    } else {
      return new Response(JSON.stringify({ error: "Percent must be >= 80 to send alert" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency check (if Supabase is available)
    if (supabaseUrl && serviceKey) {
      const supabase = createClient(supabaseUrl, serviceKey);
      const currentMonth = new Date().toISOString().slice(0, 7); // "2025-01"

      // Check if we already sent this alert this month
      const { data: existingAlert } = await supabase
        .from("usage_alert_logs")
        .select("id")
        .eq("user_id", userId)
        .eq("threshold", actualThreshold)
        .eq("month_year", currentMonth)
        .maybeSingle();

      if (existingAlert) {
        return new Response(
          JSON.stringify({ 
            message: "Alert already sent this month",
            skipped: true,
            threshold: actualThreshold 
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Generate subject and content
    const subject = actualThreshold === 80 
      ? "⚠️ You've used 80% of your monthly word limit"
      : "⛔ You've reached your monthly word limit";

    const pricingUrl = appBaseUrl ? `${appBaseUrl}/pricing` : "#";
    const dashboardUrl = appBaseUrl ? `${appBaseUrl}` : "#";

    // HTML email body
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      line-height: 1.6; 
      color: #333; 
      margin: 0; 
      padding: 0; 
      background-color: #f8fafc; 
    }
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      background: white; 
      border-radius: 12px; 
      overflow: hidden; 
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); 
    }
    .header { 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
      color: white; 
      padding: 40px 30px; 
      text-align: center; 
    }
    .header h1 { margin: 0 0 10px 0; font-size: 28px; }
    .header p { margin: 0; opacity: 0.9; }
    .content { padding: 30px; }
    .alert-box { 
      background: ${actualThreshold === 80 ? '#fef3cd' : '#f8d7da'}; 
      border: 1px solid ${actualThreshold === 80 ? '#ffeaa7' : '#f5c6cb'}; 
      border-radius: 8px; 
      padding: 20px; 
      margin: 20px 0; 
    }
    .alert-box h2 { 
      margin: 0 0 10px 0; 
      color: ${actualThreshold === 80 ? '#856404' : '#721c24'}; 
    }
    .stats { 
      background: #f8f9fa; 
      border-radius: 8px; 
      padding: 20px; 
      margin: 20px 0; 
    }
    .stats h3 { margin: 0 0 15px 0; color: #495057; }
    .progress-bar { 
      background: #e9ecef; 
      border-radius: 10px; 
      height: 20px; 
      overflow: hidden; 
      margin: 15px 0; 
    }
    .progress-fill { 
      background: ${actualThreshold === 80 ? '#ffc107' : '#dc3545'}; 
      height: 100%; 
      transition: width 0.3s ease; 
      border-radius: 10px;
    }
    .stats-list { 
      list-style: none; 
      padding: 0; 
      margin: 0; 
    }
    .stats-list li { 
      padding: 5px 0; 
      border-bottom: 1px solid #dee2e6; 
    }
    .stats-list li:last-child { border-bottom: none; }
    .cta-section { 
      text-align: center; 
      margin: 30px 0; 
    }
    .btn { 
      display: inline-block; 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
      color: white; 
      padding: 14px 28px; 
      text-decoration: none; 
      border-radius: 8px; 
      font-weight: 600; 
      margin: 10px 10px; 
      transition: transform 0.2s ease;
    }
    .btn:hover { transform: translateY(-2px); }
    .tips { 
      background: #e3f2fd; 
      border-radius: 8px; 
      padding: 20px; 
      margin: 20px 0; 
    }
    .tips h4 { 
      margin-top: 0; 
      color: #1565c0; 
    }
    .tips ul { 
      color: #1976d2; 
      margin-bottom: 0; 
    }
    .footer { 
      background: #f8f9fa; 
      padding: 20px 30px; 
      text-align: center; 
      font-size: 14px; 
      color: #6c757d; 
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${actualThreshold === 80 ? '⚠️' : '⛔'} Usage Alert</h1>
      <p>Your monthly word limit notification</p>
    </div>
    
    <div class="content">
      <div class="alert-box">
        <h2>${actualThreshold === 80 ? 'Warning: 80% Limit Reached' : 'Limit Reached: 100%'}</h2>
        <p>
          ${actualThreshold === 80 
            ? 'You\'ve used 80% of your monthly word allowance. You\'re approaching your limit!'
            : 'You\'ve reached your monthly word limit. Upgrade your plan to continue creating content.'
          }
        </p>
      </div>

      <div class="stats">
        <h3>📊 Usage Statistics</h3>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${Math.min(percent, 100)}%"></div>
        </div>
        <ul class="stats-list">
          <li><strong>Words Used:</strong> ${used.toLocaleString()}</li>
          <li><strong>Monthly Limit:</strong> ${limit.toLocaleString()}</li>
          <li><strong>Percentage:</strong> ${percent.toFixed(1)}%</li>
          <li><strong>Current Plan:</strong> ${plan.toUpperCase()}</li>
        </ul>
      </div>

      <div class="cta-section">
        <p><strong>
          ${actualThreshold === 80 
            ? 'Consider upgrading your plan to avoid interruptions:'
            : 'Upgrade your plan to continue creating amazing books:'
          }
        </strong></p>
        <a href="${pricingUrl}" class="btn">🚀 View Pricing Plans</a>
        <a href="${dashboardUrl}" class="btn">📚 Go to Dashboard</a>
      </div>

      <div class="tips">
        <h4>💡 Tips to Manage Your Usage:</h4>
        <ul>
          <li>Delete old books you no longer need</li>
          <li>Use shorter chapter lengths for practice books</li>
          <li>Consider upgrading to Pro (500K words) or Premium (2M words)</li>
          <li>Archive completed projects to free up space</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      <p>This is an automated notification from AI Book Generator.</p>
      <p>You can manage your usage and plan settings in your dashboard.</p>
    </div>
  </div>
</body>
</html>`;

    // Plain text email body
    const textBody = `
${subject}

Hi there,

${actualThreshold === 80 
  ? 'You\'ve used 80% of your monthly word allowance and are approaching your limit.'
  : 'You\'ve reached your monthly word limit. Upgrade your plan to continue creating content.'
}

📊 USAGE STATISTICS:
• Words Used: ${used.toLocaleString()}
• Monthly Limit: ${limit.toLocaleString()}
• Percentage: ${percent.toFixed(1)}%
• Current Plan: ${plan.toUpperCase()}

${actualThreshold === 80 
  ? 'Consider upgrading your plan to avoid interruptions.'
  : 'Upgrade your plan to continue creating amazing books.'
}

🚀 View Pricing: ${pricingUrl}
📚 Dashboard: ${dashboardUrl}

💡 TIPS TO MANAGE USAGE:
• Delete old books you no longer need
• Use shorter chapter lengths for practice books
• Consider upgrading to Pro (500K words) or Premium (2M words)
• Archive completed projects to free up space

---
This is an automated notification from AI Book Generator.
You can manage your usage and plan settings in your dashboard.
`;

    // Send email via Resend
    const emailPayload = {
      from: fromEmail,
      to: [email],
      subject,
      html: htmlBody,
      text: textBody,
    };

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      console.error("Resend API error:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: errorText }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const resendData = await resendResponse.json();
    console.log("Email sent successfully:", resendData);

    // Log the alert for idempotency (if Supabase is available)
    if (supabaseUrl && serviceKey) {
      try {
        const supabase = createClient(supabaseUrl, serviceKey);
        const currentMonth = new Date().toISOString().slice(0, 7); // "2025-01"

        await supabase.from("usage_alert_logs").insert({
          user_id: userId,
          threshold: actualThreshold,
          month_year: currentMonth,
          sent_at: new Date().toISOString(),
        });
      } catch (logError) {
        console.error("Failed to log alert (non-critical):", logError);
        // Don't fail the request if logging fails
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        emailId: resendData.id,
        threshold: actualThreshold,
        recipient: email,
        monthYear: new Date().toISOString().slice(0, 7)
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error in usage-alert function:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});