# Privacy & AI Consent - Test Plan

## Overview
This test plan verifies the end-to-end implementation of Privacy & AI consent functionality, ensuring users cannot sign up without consent and that Edge Functions properly enforce consent checks.

## Test Environment Setup

### Prerequisites
1. Run the database migration in Supabase SQL editor:
```sql
-- user_profiles: add AI consent + privacy fields
alter table public.user_profiles
  add column if not exists ai_processing_consent boolean not null default false,
  add column if not exists ai_consent_at timestamptz,
  add column if not exists ai_consent_version text,
  add column if not exists allow_training boolean not null default false,
  add column if not exists content_retention_days integer not null default 365,
  add column if not exists log_retention_days integer not null default 90,
  add column if not exists default_visibility text not null default 'private',
  add column if not exists gdpr_acknowledged_at timestamptz;
```

2. Ensure Edge Functions are deployed with environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` 
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`

## Test Cases

### 1. Signup Consent Enforcement

#### Test 1.1: Signup without AI consent (should fail)
**Steps:**
1. Open signup modal
2. Enter valid email/password
3. Leave AI consent checkbox unchecked
4. Leave GDPR checkbox unchecked
5. Click "Create Account"

**Expected Result:**
- Button should be disabled
- Cannot submit form
- Error message if somehow submitted: "You must consent to AI processing to create an account."

#### Test 1.2: Signup with only AI consent (should fail)
**Steps:**
1. Open signup modal
2. Enter valid email/password
3. Check AI consent checkbox
4. Leave GDPR checkbox unchecked
5. Click "Create Account"

**Expected Result:**
- Button should be disabled
- Cannot submit form
- Error message if somehow submitted: "You must acknowledge GDPR terms to create an account."

#### Test 1.3: Signup with both consents (should succeed)
**Steps:**
1. Open signup modal
2. Enter valid email/password
3. Check both AI consent and GDPR checkboxes
4. Click "Create Account"

**Expected Result:**
- Account created successfully
- Success modal shown
- User profile created with:
  - `ai_processing_consent = true`
  - `ai_consent_at = current timestamp`
  - `ai_consent_version = '2025-01-15'`
  - `gdpr_acknowledged_at = current timestamp`
  - `allow_training = false` (default)

#### Test 1.4: Login (no consent required)
**Steps:**
1. Open login modal
2. Enter valid credentials
3. Click "Sign In"

**Expected Result:**
- Login successful
- No consent checkboxes shown
- User logged in normally

### 2. Database Verification

#### Test 2.1: Verify consent storage
**Steps:**
1. After successful signup, check user_profiles table in Supabase
2. Query: `SELECT * FROM user_profiles WHERE id = '<user_id>'`

**Expected Result:**
```sql
ai_processing_consent: true
ai_consent_at: [timestamp]
ai_consent_version: '2025-01-15'
allow_training: false
content_retention_days: 365
log_retention_days: 90
default_visibility: 'private'
gdpr_acknowledged_at: [timestamp]
```

### 3. Settings Panel Privacy Controls

#### Test 3.1: View privacy settings
**Steps:**
1. Login as user with consent
2. Open Settings panel
3. Navigate to "Privacy & AI Consent" section

**Expected Result:**
- AI consent checkbox checked and shows consent timestamp
- Training opt-in checkbox unchecked (default)
- Retention settings show defaults (365/90 days)
- Default visibility set to "private"

#### Test 3.2: Modify privacy settings
**Steps:**
1. In Settings panel, change:
   - Allow training: true
   - Content retention: 180 days
   - Log retention: 30 days
   - Default visibility: "public"
2. Click "Save"

**Expected Result:**
- Settings saved successfully
- Database updated with new values
- "Saved!" confirmation shown

#### Test 3.3: Revoke AI consent
**Steps:**
1. In Settings panel, uncheck AI consent
2. Click "Save"

**Expected Result:**
- Settings saved
- `ai_processing_consent = false` in database
- User should be blocked from AI features

### 4. Edge Function Consent Enforcement

#### Test 4.1: Generate book without consent (should fail)
**Steps:**
1. Create user account with consent
2. Manually set `ai_processing_consent = false` in database
3. Try to generate a book

**Expected Result:**
- Request blocked with 403 status
- Error: "AI processing consent required. Please update your consent in account settings."

#### Test 4.2: Generate book with consent (should succeed)
**Steps:**
1. Ensure user has `ai_processing_consent = true`
2. Generate a book

**Expected Result:**
- Book generation works normally
- OpenAI API called successfully

#### Test 4.3: Generate chapter without consent (should fail)
**Steps:**
1. Set `ai_processing_consent = false` for user
2. Try to add a new chapter to existing book

**Expected Result:**
- Request blocked with 403 status
- Error: "AI processing consent required. Please update your consent in account settings."

#### Test 4.4: Rewrite passage without consent (should fail)
**Steps:**
1. Set `ai_processing_consent = false` for user
2. Try to rewrite a text passage

**Expected Result:**
- Request blocked with 403 status
- Error: "AI processing consent required. Please update your consent in account settings."

#### Test 4.5: Demo user bypass (should work)
**Steps:**
1. Use demo user (ID: '00000000-0000-0000-0000-000000000000')
2. Try AI features

**Expected Result:**
- All AI features work without consent checks
- Demo mode functions normally

### 5. Data Export & Account Deletion

#### Test 5.1: Export user data
**Steps:**
1. Login as user
2. Open Settings panel
3. Click "Export my data"

**Expected Result:**
- JSON file downloaded
- Contains all user data including privacy settings
- Filename format: `export-YYYY-MM-DD.json`

#### Test 5.2: Delete account
**Steps:**
1. Login as user
2. Open Settings panel
3. Click "Delete my account"
4. Confirm deletion

**Expected Result:**
- Account deleted successfully
- All user data removed from database
- User logged out and redirected

### 6. Edge Cases & Error Handling

#### Test 6.1: Consent version upgrade
**Steps:**
1. User with old consent version
2. Update AI_CONSENT_VERSION constant
3. User modifies settings

**Expected Result:**
- New consent version recorded
- Timestamp updated

#### Test 6.2: Missing profile data
**Steps:**
1. User without profile record
2. Try to use AI features

**Expected Result:**
- Graceful handling
- Consent check fails safely

#### Test 6.3: Network errors
**Steps:**
1. Simulate network failure during consent check
2. Try AI features

**Expected Result:**
- Request fails safely
- No AI processing without verified consent

## Verification Checklist

- [ ] Signup requires both AI and GDPR consent
- [ ] Login works without consent requirements
- [ ] Consent data stored correctly in database
- [ ] Settings panel shows and updates privacy controls
- [ ] Edge Functions block AI requests without consent
- [ ] Demo user bypasses consent checks
- [ ] Data export includes privacy settings
- [ ] Account deletion removes all data
- [ ] Error handling works for edge cases
- [ ] CORS headers work correctly
- [ ] All timestamps use correct timezone

## Success Criteria

✅ **Complete Success**: All test cases pass
⚠️ **Partial Success**: Core functionality works, minor issues in edge cases
❌ **Failure**: Critical consent enforcement not working

## Notes

- Test with multiple browsers to verify cookie behavior
- Check browser console for any JavaScript errors
- Verify database constraints prevent invalid data
- Test with different user roles/plans if applicable
- Monitor Edge Function logs for proper consent checking