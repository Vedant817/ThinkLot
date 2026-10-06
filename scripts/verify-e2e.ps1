# End-to-end verification of the ThinkLot auth + ideas chain against the live
# dev deployment, including the negative authorization cases.
#
# Note: the Convex HTTP API responds { status, value } on success and
# { status: "error", errorMessage } on failure. There is no `.result`.
$ErrorActionPreference = 'Stop'

$CONVEX = 'https://posh-chihuahua-240.convex.cloud'
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$pass = 'correct-horse-battery-staple'

function Call {
    param([string]$Path, [string]$ArgsJson = '{}', [string]$Token = $null, [ValidateSet('query','mutation','action')][string]$Kind = 'query')
    $headers = @{ 'Content-Type' = 'application/json' }
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    $body = @{ path = $Path; args = ($ArgsJson | ConvertFrom-Json); format = 'json' } | ConvertTo-Json -Depth 20 -Compress
    try {
        $r = Invoke-RestMethod -Uri "$CONVEX/api/$Kind" -Method Post -Headers $headers -Body $body -TimeoutSec 40
    } catch {
        return @{ status = 'error'; errorMessage = ($_.ErrorDetails.Message ?? $_.Exception.Message) }
    }
    return $r
}

$passes = 0
$failures = @()

function Check {
    param([string]$Name, [bool]$Ok, [string]$Detail = '')
    if ($Ok) { Write-Host "  PASS  $Name" -ForegroundColor Green; $script:passes++ }
    else { Write-Host "  FAIL  $Name   $Detail" -ForegroundColor Red; $script:failures += $Name }
}

function Refused($r) { return $r.status -eq 'error' }

Write-Host "`n== 1. Unauthenticated access must be refused ==" -ForegroundColor Cyan
Check "ideas:list without a token is refused"  (Refused (Call 'ideas:list'))  ((Call 'ideas:list').errorMessage)
Check "ideas:stats without a token is refused" (Refused (Call 'ideas:stats'))
Check "ideas:capture without a token is refused" (Refused (Call 'ideas:capture' '{"title":"x"}' $null 'mutation'))
Check "ideas:remove without a token is refused"  (Refused (Call 'ideas:remove' '{"ideaId":"j97k0000000000000000000000"}' $null 'mutation'))

Write-Host "`n== 2. Sign up ==" -ForegroundColor Cyan
$emailA = "qa-a-$stamp@example.com"
$signUpA = Call 'auth:signIn' (@{ provider='password'; params=@{ email=$emailA; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
$tokenA = $signUpA.value.tokens.token
Check "signup returns an access token" (-not [string]::IsNullOrEmpty($tokenA)) "status=$($signUpA.status) $($signUpA.errorMessage)"

$meA = Call 'users:current' '{}' $tokenA
Check "users:current resolves the signed-in email" ($meA.value.email -eq $emailA) "-> $($meA.value.email)"

$badPass = Call 'auth:signIn' (@{ provider='password'; params=@{ email=$emailA; password='wrong-password'; flow='signIn' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
Check "wrong password is rejected" (Refused $badPass) "-> status=$($badPass.status)"

Write-Host "`n== 2b. Sign IN with an existing account ==" -ForegroundColor Cyan
# This exact check was MISSING before, which is how a completely broken login
# shipped: the client omitted `flow`, so Convex Auth rejected every sign-in with
# "Missing `flow` param" and nobody could get in. The suite only ever exercised a
# WRONG password, which failed for the right reason and hid the bug.
$login = Call 'auth:signIn' (@{ provider='password'; params=@{ email=$emailA; password=$pass; flow='signIn' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
$loginToken = $login.value.tokens.token
Check "signing in with an existing account succeeds" (-not [string]::IsNullOrEmpty($loginToken)) "status=$($login.status) $($login.errorMessage)"

$asLoggedIn = Call 'users:current' '{}' $loginToken
Check "the signed-in token resolves to the same user" ($asLoggedIn.value.email -eq $emailA) "-> $($asLoggedIn.value.email)"

$noFlow = Call 'auth:signIn' (@{ provider='password'; params=@{ email=$emailA; password=$pass } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
Check "signIn without `flow` is refused (documents the footgun)" (Refused $noFlow)

Write-Host "`n== 3. Capture an idea ==" -ForegroundColor Cyan
$captured = Call 'ideas:capture' (@{ title='Whispr into the capture bar'; description='dictated, keep the raw text'; source='dictated'; transcript='whispr into the capture bar. dictated, keep the raw text' } | ConvertTo-Json -Depth 6 -Compress) $tokenA 'mutation'
$ideaIdA = $captured.value
Check "capture returns an idea id" ("$ideaIdA".Length -gt 10) "-> status=$($captured.status) $($captured.errorMessage)"

$listA = Call 'ideas:list' '{}' $tokenA
Check "list returns exactly the one captured idea" (@($listA.value.ideas).Count -eq 1) "-> count=$(@($listA.value.ideas).Count)"
Check "plate sequence starts at 1" ($listA.value.ideas[0].seq -eq 1) "-> seq=$($listA.value.ideas[0].seq)"
Check "title was parsed" ($listA.value.ideas[0].title -eq 'Whispr into the capture bar') "-> $($listA.value.ideas[0].title)"
Check "dictation source preserved" ($listA.value.ideas[0].source -eq 'dictated') "-> source=$($listA.value.ideas[0].source)"
Check "list ships a preview, not the whole 20KB body" ($null -ne $listA.value.ideas[0].preview -and $null -eq $listA.value.ideas[0].transcript) "preview=$($listA.value.ideas[0].preview)"

$fullA = Call 'ideas:get' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenA
Check "get returns the verbatim transcript" ($fullA.value.idea.transcript -like '*keep the raw text*') "-> $($fullA.value.idea.transcript)"

$statsA = Call 'ideas:stats' '{}' $tokenA
Check "stats totals 1 idea" ($statsA.value.total -eq 1) "-> total=$($statsA.value.total)"

Write-Host "`n== 3b. Email normalisation ==" -ForegroundColor Cyan
# Convex Auth's default profile returns params.email verbatim and uses it as the
# account id, so UPPER / padded variants each created a SEPARATE account for the
# same mailbox - which is also a squatting primitive. After normalisation every
# spelling must resolve to the SAME user id (session ids legitimately differ).
function JwtSubject($token) {
    $p = $token.Split('.')[1].Replace('-', '+').Replace('_', '/')
    while ($p.Length % 4 -ne 0) { $p += '=' }
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
    return ($json.sub -split '\|')[0]
}

$upper = Call 'auth:signIn' (@{ provider='password'; params=@{ email=$emailA.ToUpper(); password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
Check "uppercase variant of the same email resolves to the SAME user" ((JwtSubject $upper.value.tokens.token) -eq (JwtSubject $tokenA)) "-> uppercase sub vs original sub"

$padded = Call 'auth:signIn' (@{ provider='password'; params=@{ email="  $emailA "; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
Check "padded variant of the same email resolves to the SAME user" ((JwtSubject $padded.value.tokens.token) -eq (JwtSubject $tokenA))

Check "a malformed email is refused" (Refused (Call 'auth:signIn' (@{ provider='password'; params=@{ email='not-an-email'; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'))

Write-Host "`n== 4. A second user must see nothing of user A ==" -ForegroundColor Cyan
$emailB = "qa-b-$stamp@example.com"
$signUpB = Call 'auth:signIn' (@{ provider='password'; params=@{ email=$emailB; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
$tokenB = $signUpB.value.tokens.token
Check "second signup succeeds" (-not [string]::IsNullOrEmpty($tokenB))

$listB = Call 'ideas:list' '{}' $tokenB
Check "user B's list is empty (no leak)" (@($listB.value.ideas).Count -eq 0) "-> count=$(@($listB.value.ideas).Count)"

$peekB = Call 'ideas:get' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenB
Check "user B reading A's idea by id gets null" ($null -eq $peekB.value) "-> $($peekB.value | ConvertTo-Json -Compress)"

Write-Host "`n== 5. User B must not be able to write to user A's idea ==" -ForegroundColor Cyan
$steal = Call 'ideas:setStatus' (@{ideaId=$ideaIdA; status='done'} | ConvertTo-Json -Compress) $tokenB 'mutation'
$afterA = Call 'ideas:get' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenA
Check "B's write did not change A's idea" ($afterA.value.idea.status -eq 'inbox') "-> status=$($afterA.value.idea.status) (B's call status=$($steal.status))"

$steal2 = Call 'ideas:remove' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenB 'mutation'
$stillThere = Call 'ideas:get' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenA
Check "B could not delete A's idea" ($null -ne $stillThere.value) "-> B's delete status=$($steal2.status)"

Write-Host "`n== 6. Validation ==" -ForegroundColor Cyan
Check "whitespace-only title rejected" (Refused (Call 'ideas:capture' (@{title='   '} | ConvertTo-Json -Compress) $tokenA 'mutation'))
Check "out-of-range impact rejected" (Refused (Call 'ideas:update' (@{ideaId=$ideaIdA; impact=99} | ConvertTo-Json -Compress) $tokenA 'mutation'))
Check "fractional score rejected" (Refused (Call 'ideas:update' (@{ideaId=$ideaIdA; confidence=4.5} | ConvertTo-Json -Compress) $tokenA 'mutation'))
$dupTag = Call 'ideas:update' (@{ideaId=$ideaIdA; tags=@('Mobile','mobile','  MOBILE  ')} | ConvertTo-Json -Depth 5 -Compress) $tokenA 'mutation'
$afterTags = Call 'ideas:get' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenA
Check "tags normalise to lowercase and dedupe" (@($afterTags.value.idea.tags).Count -eq 1 -and $afterTags.value.idea.tags[0] -eq 'mobile') "-> $($afterTags.value.idea.tags -join ',')"

Write-Host "`n== 7. Plate sequence does not collide or get reused ==" -ForegroundColor Cyan
$null = Call 'ideas:capture' '{"title":"second idea"}' $tokenA 'mutation'
$null = Call 'ideas:capture' '{"title":"third idea"}' $tokenA 'mutation'
$listA2 = Call 'ideas:list' '{}' $tokenA
$seqs = @($listA2.value.ideas | ForEach-Object { $_.seq })
Check "3 ideas, 3 unique sequence numbers" (($seqs | Select-Object -Unique).Count -eq 3) "-> seqs=$($seqs -join ',')"
Check "list is sorted newest plate first" ($listA2.value.ideas[0].seq -eq 3) "-> first seq=$($listA2.value.ideas[0].seq)"

# Plates used to come from `max(existing seq) + 1`, so deleting the highest one
# handed the SAME plate to the next capture - two different ideas could share
# LOT-0003, which breaks the app's core conversational primitive.
$topId = $listA2.value.ideas[0]._id
$null = Call 'ideas:remove' (@{ideaId=$topId} | ConvertTo-Json -Compress) $tokenA 'mutation'
$null = Call 'ideas:capture' '{"title":"after deletion"}' $tokenA 'mutation'
$listA3 = Call 'ideas:list' '{}' $tokenA
$newSeq = ($listA3.value.ideas | Where-Object { $_.title -eq 'after deletion' }).seq
Check "a plate is never reused after deletion" ($newSeq -gt 3) "-> new seq=$newSeq (was 3 before, would have collided)"

Write-Host "`n== 8. Archive round-trip preserves status ==" -ForegroundColor Cyan
$beforeArchive = (Call 'ideas:list' '{}' $tokenA).value.ideas.Count
$allBefore = (Call 'ideas:list' '{"includeArchived":true}' $tokenA).value.ideas.Count
$aId = ($listA3.value.ideas | Where-Object { $_.title -eq 'after deletion' })._id
$null = Call 'ideas:setStatus' (@{ideaId=$aId; status='reviewing'} | ConvertTo-Json -Compress) $tokenA 'mutation'
$null = Call 'ideas:setArchived' (@{ideaId=$aId; archived=$true; statusBeforeArchive='reviewing'} | ConvertTo-Json -Compress) $tokenA 'mutation'
$archivedList = Call 'ideas:list' '{"includeArchived":true}' $tokenA
$archivedIdea = $archivedList.value.ideas | Where-Object { $_._id -eq $aId }
Check "archived idea hidden from default list" ((Call 'ideas:list' '{}' $tokenA).value.ideas.Count -eq ($beforeArchive - 1)) "-> visible=$((Call 'ideas:list' '{}' $tokenA).value.ideas.Count) expected=$($beforeArchive - 1)"
Check "archived idea visible with includeArchived" ($archivedList.value.ideas.Count -eq $allBefore) "-> all=$($archivedList.value.ideas.Count) expected=$allBefore"
Check "archived idea parked while away" ($archivedIdea.status -eq 'parked') "-> status=$($archivedIdea.status)"
$null = Call 'ideas:setArchived' (@{ideaId=$aId; archived=$false; statusBeforeArchive='reviewing'} | ConvertTo-Json -Compress) $tokenA 'mutation'
$restored = (Call 'ideas:get' (@{ideaId=$aId} | ConvertTo-Json -Compress) $tokenA).value.idea
Check "restoring returns it to its previous stage" ($restored.status -eq 'reviewing') "-> status=$($restored.status)"

Write-Host "`n== 9. revisitAt validation ==" -ForegroundColor Cyan
# revisitAt had no validation while every sibling numeric field was range-checked,
# so -1e308, 1e308 and 0.5 all persisted into an indexed field.
foreach ($junk in @(-1e308, 1e308, -999999, 0.5, 1.5)) {
    $r = Call 'ideas:update' (@{ ideaId=$aId; revisitAt=$junk } | ConvertTo-Json -Compress) $tokenA 'mutation'
    Check "revisitAt=$junk is rejected" (Refused $r) "-> $($r.errorMessage)"
}
$okRevisit = Call 'ideas:update' (@{ ideaId=$aId; revisitAt=[DateTimeOffset]::UtcNow.AddDays(7).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress) $tokenA 'mutation'
Check "a real future revisit date is accepted" (-not (Refused $okRevisit))
Check "clearing revisitAt is accepted" (-not (Refused (Call 'ideas:update' (@{ ideaId=$aId; revisitAt=$null } | ConvertTo-Json -Compress) $tokenA 'mutation')))

Write-Host "`n== 10. Long captures are never truncated ==" -ForegroundColor Cyan
# The client splits a long capture into a title + description before it ever
# reaches the server (parseCapture). What the server must guarantee is that a
# 400-character blob is representable, not that it can be a single 400-char title.
$long = "We should build a thing that helps people. " + ("B" * 357)
$lc = Call 'ideas:capture' (@{ title='We should build a thing that helps people.'; description=$long } | ConvertTo-Json -Depth 5 -Compress) $tokenA 'mutation'
Check "a 400-char capture is accepted as title + description" (-not (Refused $lc)) "-> $($lc.errorMessage)"
if (-not (Refused $lc)) {
    $roundTrip = (Call 'ideas:get' (@{ideaId=$lc.value} | ConvertTo-Json -Compress) $tokenA).value.idea
    Check "the full text is stored, not truncated" ($roundTrip.description.Length -ge 390) "-> stored length=$($roundTrip.description.Length)"
}
$overLongTitle = Call 'ideas:capture' (@{ title=("x" * 301) } | ConvertTo-Json -Depth 5 -Compress) $tokenA 'mutation'
Check "an over-long title is rejected rather than silently cut" (Refused $overLongTitle)

Write-Host "`n-------------------------------------------"
if ($failures.Count -eq 0) { Write-Host "ALL PASSED: $passes checks" -ForegroundColor Green }
else { Write-Host "PASSED: $passes   FAILED: $($failures.Count)" -ForegroundColor Red; $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red } }
Write-Host "`nQA accounts created: $emailA / $emailB" -ForegroundColor DarkGray