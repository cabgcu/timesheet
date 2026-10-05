/*
 * Canyon Activities Board - Timesheet Automation
 *
 * INSTRUCTIONS:
 * 1. Go to https://script.google.com/ and create a "New Project".
 * 2. Delete all existing code and paste THIS ENTIRE block.
 * 3. Update the SUPABASE_KEY if necessary.
 * 4. Save and run the "checkTimesheetsAndSendEmails" function once to authorize.
 * 5. Set up your Trigger (Time-driven -> Week timer -> Monday -> 8am-9am).
 */

// --- CONFIGURATION ---
const SUPABASE_URL = "https://nmmshjdknmuzpgpquwec.supabase.co";
// Ensure this key is valid for your Supabase project
const SUPABASE_KEY = "sb_publishable_PCxlxywY7W6K3TmMrSnSsw_NPXKugoZ";

// --- HELPERS ---

function fetchSupabase(table, query = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`;
  const options = {
    method: "GET",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json"
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    Logger.log("Error fetching " + table + ": " + response.getContentText());
    return [];
  }
  return JSON.parse(response.getContentText());
}

function formatWeekRange(dateStr) {
  const start = new Date(dateStr + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const options = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}, ${end.getFullYear()}`;
}

// --- MAIN AUTOMATION ---

function checkTimesheetsAndSendEmails() {
  Logger.log("Starting Timesheet Check...");

  // 1. Determine the week identifier (Monday of last week, Arizona time)
  const today = new Date();
  const lastMonday = new Date(today);
  lastMonday.setDate(today.getDate() - today.getDay() + 1 - 7);
  const weekId = Utilities.formatDate(lastMonday, "America/Phoenix", "yyyy-MM-dd");
  const weekString = formatWeekRange(weekId);

  Logger.log("Checking week of: " + weekId + " (" + weekString + ")");

  // 2. Fetch System Settings
  const settingsData = fetchSupabase("settings");
  let activeYear = "";
  let threshold = 7;
  let staffList = [];
  let positions = [];

  settingsData.forEach(row => {
    if (row.key === "ActiveYear") activeYear = row.value;
    if (row.key === "SubmissionThreshold") threshold = parseInt(row.value) || 7;
    if (row.key === "Staff") staffList = JSON.parse(row.value || "[]");
    if (row.key === "Positions") positions = JSON.parse(row.value || "[]");
  });

  if (!activeYear) {
    Logger.log("No active year set. Exiting.");
    return;
  }

  const positionMinHours = {};
  positions.forEach(p => {
    positionMinHours[p.name] = p.minHours;
  });

  // 3. Fetch Submissions for last week
  const submissions = fetchSupabase("submissions", `academic_year=eq.${encodeURIComponent(activeYear)}&week_identifier=eq.${weekId}`);

  // 4. CHECK THRESHOLD (Break Week Logic)
  const activeStudentsCount = submissions.filter(s => parseFloat(s.total_hours) > 0).length;
  Logger.log(`Active students who submitted hours: ${activeStudentsCount} / Threshold: ${threshold}`);

  if (activeStudentsCount < threshold) {
    Logger.log("Threshold not met. System assumes this is a Break Week. Emails are paused.");
    return;
  }

  // 5. Fetch Active Roster
  const roster = fetchSupabase("roster", `academic_year=eq.${encodeURIComponent(activeYear)}`);

  // 6. Process Roster and Send Emails
  let emailsSent = 0;

  roster.forEach(student => {
    if (!student.email || !student.position) return;

    const reqHours = positionMinHours[student.position] || 0;
    if (reqHours <= 0) return;

    const studentSub = submissions.find(s => s.student_id === student.student_id);
    const loggedHours = studentSub ? parseFloat(studentSub.total_hours) : 0;

    if (loggedHours < reqHours) {

      const teamDirectors = roster
        .filter(s => s.team === student.team && s.position === "Director" && s.email)
        .map(s => s.email);

      const teamStaff = staffList
        .filter(staff => staff.teams && staff.teams.includes(student.team) && staff.email)
        .map(staff => staff.email);

      const ccList = [...new Set([...teamDirectors, ...teamStaff])].join(",");

      const subject = `Action Needed: Timesheet Update - ${weekString}`;

      const htmlBody = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">

          <div style="background-color: #000000; padding: 24px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 600;">Action Required: Timesheet Update</h2>
          </div>

          <div style="padding: 32px 24px;">
            <p style="font-size: 16px; color: #374151; margin-top: 0;">Hello <strong>${student.name}</strong>,</p>

            <p style="font-size: 16px; color: #4b5563; line-height: 1.6;">
              You are receiving this automated notification because your logged hours for the week of <strong>${weekString}</strong> did not meet your position's minimum requirement.
            </p>

            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 24px 0;">
              <h3 style="margin-top: 0; color: #1e293b; font-size: 15px; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em;">Weekly Summary</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 15px;">Team</td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #334155;">${student.team}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 15px;">Position</td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #334155;">${student.position}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 15px;">Required Hours</td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #059669;">${reqHours.toFixed(1)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 15px;">Logged Hours</td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #e11d48;">${loggedHours.toFixed(1)}</td>
                </tr>
              </table>
            </div>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin-bottom: 24px; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #1e3a8a; font-size: 15px; line-height: 1.5;">
                <strong>Important:</strong> Please reach out to your staff member for next steps. As a reminder, all hours must be submitted by <strong>11:59 PM on Sunday nights</strong>.
              </p>
            </div>

            <p style="font-size: 15px; color: #4b5563; margin-bottom: 0;">Thank you,</p>
            <p style="font-size: 15px; color: #4b5563; font-weight: 600; margin-top: 4px;">— Canyon Activities Board</p>
          </div>

          <div style="background-color: #f9fafb; padding: 16px; border-top: 1px solid #e5e7eb; text-align: center;">
            <p style="font-size: 12px; color: #9ca3af; margin: 0;">This is an automated message from the CAB Timesheet System.</p>
          </div>
        </div>
      `;

      try {
        GmailApp.sendEmail(student.email, subject, "", {
          htmlBody: htmlBody,
          cc: ccList,
          name: "Canyon Activities Board"
        });
        Logger.log(`Sent email to ${student.name} (${student.email}). CC: ${ccList}`);
        emailsSent++;
      } catch (err) {
        Logger.log(`Failed to send email to ${student.email}: ${err.message}`);
      }
    }
  });

  Logger.log(`Timesheet Check Complete. Total emails sent: ${emailsSent}`);
}

// --- TEST FUNCTION ---

function testSendEmail() {
  const testEmail = "Chris.Hinojosa@gcu.edu";
  const subject = "Action Needed: Timesheet Update - [Test Date Range]";
  const htmlBody = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">

      <div style="background-color: #000000; padding: 24px; text-align: center;">
        <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 600;">Action Required: Timesheet Update (Test)</h2>
      </div>

      <div style="padding: 32px 24px;">
        <p style="font-size: 16px; color: #374151; margin-top: 0;">Hello <strong>Student Name</strong>,</p>

        <p style="font-size: 16px; color: #4b5563; line-height: 1.6;">
          You are receiving this automated notification because your logged hours for the week of <strong>[Test Date Range]</strong> did not meet your position's minimum requirement.
        </p>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <h3 style="margin-top: 0; color: #1e293b; font-size: 15px; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em;">Weekly Summary</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 15px;">Team</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #334155;">Test Team</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 15px;">Position</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #334155;">Test Position</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 15px;">Required Hours</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #059669;">10.0</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 15px;">Logged Hours</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #e11d48;">4.5</td>
            </tr>
          </table>
        </div>

        <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin-bottom: 24px; border-radius: 0 8px 8px 0;">
          <p style="margin: 0; color: #1e3a8a; font-size: 15px; line-height: 1.5;">
            <strong>Important:</strong> Please reach out to your staff member for next steps. As a reminder, all hours must be submitted by <strong>11:59 PM on Sunday nights</strong>.
          </p>
        </div>

        <p style="font-size: 15px; color: #4b5563; margin-bottom: 0;">Thank you,</p>
        <p style="font-size: 15px; color: #4b5563; font-weight: 600; margin-top: 4px;">— Canyon Activities Board</p>
      </div>

      <div style="background-color: #f9fafb; padding: 16px; border-top: 1px solid #e5e7eb; text-align: center;">
        <p style="font-size: 12px; color: #9ca3af; margin: 0;">This is an automated message from the CAB Timesheet System.</p>
      </div>
    </div>
  `;

  GmailApp.sendEmail(testEmail, subject, "", {
    htmlBody: htmlBody,
    name: "Canyon Activities Board"
  });
  Logger.log(`Test email sent to ${testEmail}`);
}
