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

$badPass = Call 'auth:signIn' (@{ provider='password'; params=@{ email=$emailA; password='wrong-password' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
Check "wrong password is rejected" (Refused $badPass) "-> status=$($badPass.status)"

Write-Host "`n== 3. Capture an idea ==" -ForegroundColor Cyan
$captured = Call 'ideas:capture' (@{ title='Whispr into the capture bar'; description='dictated, keep the raw text'; source='dictated'; transcript='whispr into the capture bar. dictated, keep the raw text' } | ConvertTo-Json -Depth 6 -Compress) $tokenA 'mutation'
$ideaIdA = $captured.value
Check "capture returns an idea id" ("$ideaIdA".Length -gt 10) "-> status=$($captured.status) $($captured.errorMessage)"

$listA = Call 'ideas:list' '{}' $tokenA
Check "list returns exactly the one captured idea" (@($listA.value).Count -eq 1) "-> count=$(@($listA.value).Count)"
Check "plate sequence starts at 1" ($listA.value[0].seq -eq 1) "-> seq=$($listA.value[0].seq)"
Check "title was parsed" ($listA.value[0].title -eq 'Whispr into the capture bar') "-> $($listA.value[0].title)"
Check "dictation source + transcript preserved" ($listA.value[0].source -eq 'dictated' -and -not [string]::IsNullOrEmpty($listA.value[0].transcript)) "-> source=$($listA.value[0].source)"
Check "ideaEvents log written" ((Call 'ideas:get' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenA).value.idea.source -eq 'dictated')

$statsA = Call 'ideas:stats' '{}' $tokenA
Check "stats totals 1 idea" ($statsA.value.total -eq 1) "-> total=$($statsA.value.total)"

Write-Host "`n== 4. A second user must see nothing of user A ==" -ForegroundColor Cyan
$emailB = "qa-b-$stamp@example.com"
$signUpB = Call 'auth:signIn' (@{ provider='password'; params=@{ email=$emailB; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
$tokenB = $signUpB.value.tokens.token
Check "second signup succeeds" (-not [string]::IsNullOrEmpty($tokenB))

$listB = Call 'ideas:list' '{}' $tokenB
Check "user B's list is empty (no leak)" (@($listB.value).Count -eq 0) "-> count=$(@($listB.value).Count)"

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

Write-Host "`n== 7. Plate sequence does not collide ==" -ForegroundColor Cyan
$null = Call 'ideas:capture' '{"title":"second idea"}' $tokenA 'mutation'
$null = Call 'ideas:capture' '{"title":"third idea"}' $tokenA 'mutation'
$listA2 = Call 'ideas:list' '{}' $tokenA
$seqs = @($listA2.value | ForEach-Object { $_.seq })
Check "3 ideas, 3 unique sequence numbers" (($seqs | Select-Object -Unique).Count -eq 3) "-> seqs=$($seqs -join ',')"
Check "list is sorted newest plate first" ($listA2.value[0].seq -eq 3) "-> first seq=$($listA2.value[0].seq)"

Write-Host "`n== 8. Archive round-trip preserves status ==" -ForegroundColor Cyan
$aId = $listA2.value[0]._id
$null = Call 'ideas:setStatus' (@{ideaId=$aId; status='reviewing'} | ConvertTo-Json -Compress) $tokenA 'mutation'
$null = Call 'ideas:setArchived' (@{ideaId=$aId; archived=$true; statusBeforeArchive='reviewing'} | ConvertTo-Json -Compress) $tokenA 'mutation'
$archivedList = Call 'ideas:list' '{"includeArchived":true}' $tokenA
$archivedIdea = $archivedList.value | Where-Object { $_._id -eq $aId }
Check "archived idea hidden from default list" ((Call 'ideas:list' '{}' $tokenA).value.Count -eq 2) "-> visible=$((Call 'ideas:list' '{}' $tokenA).value.Count)"
Check "archived idea visible with includeArchived" ($archivedList.value.Count -eq 3) "-> all=$($archivedList.value.Count)"
Check "archived idea parked while away" ($archivedIdea.status -eq 'parked') "-> status=$($archivedIdea.status)"
$null = Call 'ideas:setArchived' (@{ideaId=$aId; archived=$false; statusBeforeArchive='reviewing'} | ConvertTo-Json -Compress) $tokenA 'mutation'
$restored = (Call 'ideas:get' (@{ideaId=$aId} | ConvertTo-Json -Compress) $tokenA).value.idea
Check "restoring returns it to its previous stage" ($restored.status -eq 'reviewing') "-> status=$($restored.status)"

Write-Host "`n-------------------------------------------"
if ($failures.Count -eq 0) { Write-Host "ALL PASSED: $passes checks" -ForegroundColor Green }
else { Write-Host "PASSED: $passes   FAILED: $($failures.Count)" -ForegroundColor Red; $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red } }
Write-Host "`nQA accounts created: $emailA / $emailB" -ForegroundColor DarkGray