// ==========================================
// CANYON ACTIVITIES BOARD - TIMESHEET SERVER
// ==========================================

function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let settingsSheet = ss.getSheetByName('Settings');
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet('Settings');
    settingsSheet.appendRow(['Key', 'Value']);
    settingsSheet.getRange('A1:B1').setFontWeight('bold');
    settingsSheet.appendRow(['AdminPassword', 'admin123']);
    settingsSheet.appendRow(['ActiveYear', '2025-2026']);
    settingsSheet.appendRow(['Teams', JSON.stringify(['Arts Team', 'CAB Team', 'Media Team', 'Street Team'])]);
    settingsSheet.appendRow(['AcademicYears', JSON.stringify(['2024-2025', '2025-2026'])]);
  }

  let rosterSheet = ss.getSheetByName('Roster');
  if (!rosterSheet) {
    rosterSheet = ss.insertSheet('Roster');
    rosterSheet.appendRow(['AcademicYear', 'StudentID', 'Name', 'Team']);
    rosterSheet.getRange('A1:D1').setFontWeight('bold');
  }

  let subSheet = ss.getSheetByName('Submissions');
  if (!subSheet) {
    subSheet = ss.insertSheet('Submissions');
    subSheet.appendRow(['AcademicYear', 'StudentID', 'Name', 'Team', 'WeekIdentifier', 'TotalHours', 'LogsJSON', 'Timestamp']);
    subSheet.getRange('A1:H1').setFontWeight('bold');
  }

  // Drafts sheet: stores in-progress (not yet submitted) logs per student per week
  let draftsSheet = ss.getSheetByName('Drafts');
  if (!draftsSheet) {
    draftsSheet = ss.insertSheet('Drafts');
    draftsSheet.appendRow(['StudentID', 'WeekIdentifier', 'LogsJSON', 'LastUpdated']);
    draftsSheet.getRange('A1:D1').setFontWeight('bold');
  }
}

function getSetting(key) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Settings');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() === key.toLowerCase()) return data[i][1];
  }
  return null;
}

function setSetting(key, value) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Settings');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() === key.toLowerCase()) {
      sheet.getRange(i + 1, 2).setValue(typeof value === 'string' ? value : JSON.stringify(value));
      return;
    }
  }
  sheet.appendRow([key, typeof value === 'string' ? value : JSON.stringify(value)]);
}

function getFullRoster() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Roster');
  const data = sheet.getDataRange().getValues();
  const rosters = {};
  for (let i = 1; i < data.length; i++) {
    const year = data[i][0];
    if (!year) continue;
    if (!rosters[year]) rosters[year] = [];
    rosters[year].push({ id: data[i][1].toString(), name: data[i][2], team: data[i][3] });
  }
  return rosters;
}

function doPost(e) {
  let response = { success: false, message: 'Unknown error' };

  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // ------------------------------------------------
    // PUBLIC ACTIONS
    // ------------------------------------------------

    if (action === 'getConfig') {
      response = {
        success: true,
        activeYear: getSetting('ActiveYear'),
        teams: JSON.parse(getSetting('Teams') || '[]'),
        academicYears: JSON.parse(getSetting('AcademicYears') || '[]'),
        rosters: getFullRoster()
      };
    }

    else if (action === 'studentLogin') {
      const rosters = getFullRoster();
      let foundStudent = null;

      for (const year in rosters) {
        const match = rosters[year].find(s => s.id === params.studentId.toString().trim());
        if (match) { foundStudent = match; break; }
      }

      if (!foundStudent) {
        response = { success: false, message: 'Student ID not found.' };
      } else {
        const subSheet = ss.getSheetByName('Submissions');
        const subData = subSheet.getDataRange().getValues();
        const studentSubmissions = [];

        for (let i = 1; i < subData.length; i++) {
          if (subData[i][1].toString() === foundStudent.id) {
            studentSubmissions.push({
              academicYear:   subData[i][0].toString(),
              studentId:      subData[i][1].toString(),
              studentName:    subData[i][2].toString(),
              team:           subData[i][3].toString(),
              weekIdentifier: subData[i][4].toString(),
              totalHours:     Number(subData[i][5]),
              logs:           JSON.parse(subData[i][6] || '[]')
            });
          }
        }

        response = { success: true, student: foundStudent, submissions: studentSubmissions };
      }
    }

    // Save in-progress draft logs for the current week (not a final submission)
    else if (action === 'saveDraft') {
      const draftsSheet = ss.getSheetByName('Drafts');
      if (!draftsSheet) throw new Error('Drafts sheet missing — run setupDatabase()');

      const data = draftsSheet.getDataRange().getValues();
      const logsJson = JSON.stringify(params.logs || []);
      const now = new Date().toISOString();
      let rowIndex = -1;

      for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString() === params.studentId.toString() &&
            data[i][1].toString() === params.weekIdentifier) {
          rowIndex = i + 1;
          break;
        }
      }

      if (rowIndex > -1) {
        draftsSheet.getRange(rowIndex, 3).setValue(logsJson);
        draftsSheet.getRange(rowIndex, 4).setValue(now);
      } else {
        draftsSheet.appendRow([params.studentId.toString(), params.weekIdentifier, logsJson, now]);
      }

      response = { success: true };
    }

    // Retrieve in-progress draft logs for a student + week
    else if (action === 'getDraft') {
      const draftsSheet = ss.getSheetByName('Drafts');
      if (!draftsSheet) {
        response = { success: true, logs: [] };
      } else {
        const data = draftsSheet.getDataRange().getValues();
        let logs = [];
        for (let i = 1; i < data.length; i++) {
          if (data[i][0].toString() === params.studentId.toString() &&
              data[i][1].toString() === params.weekIdentifier) {
            logs = JSON.parse(data[i][2] || '[]');
            break;
          }
        }
        response = { success: true, logs: logs };
      }
    }

    else if (action === 'submitTimesheet') {
      const activeYear = getSetting('ActiveYear');
      const rosters = getFullRoster();
      const student = (rosters[activeYear] || []).find(s => s.id === params.studentId.toString());
      if (!student) throw new Error('Student not authorized.');

      const subSheet = ss.getSheetByName('Submissions');
      const data = subSheet.getDataRange().getValues();
      const timestamp = new Date().toISOString();
      let rowIndex = -1;

      for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString() === activeYear &&
            data[i][1].toString() === student.id &&
            data[i][4].toString() === params.weekIdentifier) {
          rowIndex = i + 1;
          break;
        }
      }

      if (rowIndex > -1) {
        const existingLogs = JSON.parse(data[rowIndex - 1][6] || '[]');
        const updatedLogs = existingLogs.concat(params.logs);
        const newTotal = updatedLogs.reduce((sum, l) => sum + Number(l.hours), 0);
        subSheet.getRange(rowIndex, 6).setValue(newTotal);
        subSheet.getRange(rowIndex, 7).setValue(JSON.stringify(updatedLogs));
        subSheet.getRange(rowIndex, 8).setValue(timestamp);
      } else {
        const newTotal = params.logs.reduce((sum, l) => sum + Number(l.hours), 0);
        subSheet.appendRow([activeYear, student.id, student.name, student.team, params.weekIdentifier, newTotal, JSON.stringify(params.logs), timestamp]);
      }

      // Clear the draft once the week has been officially submitted
      const draftsSheet = ss.getSheetByName('Drafts');
      if (draftsSheet) {
        const draftData = draftsSheet.getDataRange().getValues();
        for (let i = 1; i < draftData.length; i++) {
          if (draftData[i][0].toString() === student.id &&
              draftData[i][1].toString() === params.weekIdentifier) {
            draftsSheet.deleteRow(i + 1);
            break;
          }
        }
      }

      response = { success: true };
    }

    // ------------------------------------------------
    // ADMIN ACTIONS (password required)
    // ------------------------------------------------

    else {
      if (params.password !== getSetting('AdminPassword')) {
        return ContentService
          .createTextOutput(JSON.stringify({ success: false, message: 'Invalid Admin Password' }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      if (action === 'adminLogin') {
        response = { success: true };
      }

      else if (action === 'getAdminData') {
        const subSheet = ss.getSheetByName('Submissions');
        const subData = subSheet.getDataRange().getValues();
        const allSubmissions = [];

        for (let i = 1; i < subData.length; i++) {
          if (!subData[i][0]) continue;
          allSubmissions.push({
            academicYear:   subData[i][0].toString(),
            studentId:      subData[i][1].toString(),
            studentName:    subData[i][2].toString(),
            name:           subData[i][2].toString(),
            team:           subData[i][3].toString(),
            weekIdentifier: subData[i][4].toString(),
            totalHours:     Number(subData[i][5]),
            hours:          Number(subData[i][5]),
            logs:           JSON.parse(subData[i][6] || '[]')
          });
        }

        response = { success: true, rosters: getFullRoster(), submissions: allSubmissions };
      }

      else if (action === 'adminUpdateSubmission') {
        const subSheet = ss.getSheetByName('Submissions');
        const data = subSheet.getDataRange().getValues();
        let rowFound = false;

        for (let i = 1; i < data.length; i++) {
          if (data[i][0].toString() === params.academicYear &&
              data[i][1].toString() === params.studentId.toString() &&
              data[i][4].toString() === params.weekIdentifier) {
            if (params.logs.length === 0) {
              subSheet.deleteRow(i + 1);
            } else {
              const newTotal = params.logs.reduce((sum, l) => sum + Number(l.hours), 0);
              subSheet.getRange(i + 1, 6).setValue(newTotal);
              subSheet.getRange(i + 1, 7).setValue(JSON.stringify(params.logs));
              subSheet.getRange(i + 1, 8).setValue(new Date().toISOString());
            }
            rowFound = true;
            break;
          }
        }

        if (!rowFound && params.logs.length > 0) {
          const activeYear = getSetting('ActiveYear');
          const rosters = getFullRoster();
          const student = (rosters[params.academicYear] || []).find(s => s.id === params.studentId.toString());
          if (!student) throw new Error('Student not found');
          const newTotal = params.logs.reduce((sum, l) => sum + Number(l.hours), 0);
          subSheet.appendRow([params.academicYear, params.studentId, student.name, student.team, params.weekIdentifier, newTotal, JSON.stringify(params.logs), new Date().toISOString()]);
        }

        response = { success: true };
      }

      else if (action === 'saveSettings') {
        if (params.newPassword)   setSetting('AdminPassword',  params.newPassword);
        if (params.activeYear)    setSetting('ActiveYear',     params.activeYear);
        if (params.teams)         setSetting('Teams',          params.teams);
        if (params.academicYears) setSetting('AcademicYears',  params.academicYears);
        response = { success: true };
      }

      else if (action === 'saveRoster') {
        const rosterSheet = ss.getSheetByName('Roster');
        if (rosterSheet.getLastRow() > 1) {
          rosterSheet.getRange(2, 1, rosterSheet.getLastRow() - 1, 4).clearContent();
        }
        const newRows = [];
        for (const year in params.rosters) {
          (params.rosters[year] || []).forEach(s => newRows.push([year, s.id, s.name, s.team]));
        }
        if (newRows.length > 0) rosterSheet.getRange(2, 1, newRows.length, 4).setValues(newRows);
        response = { success: true };
      }
    }

  } catch (error) {
    response = { success: false, message: error.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}
