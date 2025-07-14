if (-not (Get-Module -ListAvailable -Name Microsoft.Graph)) {
    Write-Host "Microsoft.Graph module is not installed. Installing..." -ForegroundColor Yellow
    Install-Module -Name Microsoft.Graph -Scope CurrentUser -Force -AllowClobber
}


Connect-MgGraph -Scopes 'Application.ReadWrite.All', 'AppRoleAssignment.ReadWrite.All', 'Directory.Read.All'


function Get-AllServicePrincipals {
    Write-Output "Fetching all service principals..."
    $apps = Get-MgServicePrincipal -All
    return $apps
}


function Filter-Identities($identities, $searchTerm) {
    return $identities | Where-Object { $_.DisplayName -like "*$searchTerm*" }
}


function Add-GraphScopes($spId, $displayName) {
    Write-Host "Assigning Graph scopes to: $displayName" -ForegroundColor Yellow


    $availableScopes = @()
    Write-Host "Enter Graph scopes you want to add one by one (e.g. User.Read.All, Group.ReadWrite.All). Press Enter on empty input to finish." -ForegroundColor Cyan
    while ($true) {
        $scope = Read-Host "Enter scope"
        if ([string]::IsNullOrWhiteSpace($scope)) { break }
        $availableScopes += $scope
    }


    if ($availableScopes.Count -eq 0) {
        Write-Warning "No scopes entered."
        return
    }


    $graphSp = Get-MgServicePrincipal -Filter "AppId eq '00000003-0000-0000-c000-000000000000'" # Microsoft Graph
    $graphAppRoles = $graphSp.AppRoles
    $app = Get-MgServicePrincipal -ServicePrincipalId $spId


    foreach ($scope in $availableScopes) {
        $role = $graphAppRoles | Where-Object { $_.Value -eq $scope -and $_.AllowedMemberTypes -contains 'Application' }
        if (-not $role) {
            Write-Warning "Scope '$scope' is invalid or not available as an Application permission."
            continue
        }


        try {
            New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $spId `
                -PrincipalId $spId `
                -ResourceId $graphSp.Id `
                -AppRoleId $role.Id
            Write-Host "Assigned '$scope' to $displayName." -ForegroundColor Green
        } catch {
            Write-Warning "Failed to assign '$scope': $_"
        }
    }


    $url = "https://portal.azure.com/#view/Microsoft_AAD_IAM/ManagedAppMenuBlade/~/Overview/objectId/$spId/appId/$($app.AppId)/preferredSingleSignOnMode~/null/servicePrincipalType/ManagedIdentity/fromNav/"
    Write-Host "Opening Azure Portal for $displayName..."
    Start-Process $url
}


# main loop
$identities = Get-AllServicePrincipals
if ($identities.Count -eq 0) {
    Write-Warning "No service principals found."
    return
}


Write-Host "
 ____ ____ ____ ____ ____ ____ ____ ____ ____ ____ ____ ____ 
||A |||z |||S |||c |||o |||p |||e |||a |||d |||m |||i |||n ||
||__|||__|||__|||__|||__|||__|||__|||__|||__|||__|||__|||__||
|/__\|/__\|/__\|/__\|/__\|/__\|/__\|/__\|/__\|/__\|/__\|/__\|
" -foregroundColor Green
Write-Host "$($identities.Count) service principals found." -ForegroundColor Cyan


while ($true) {
    $searchTerm = Read-Host "Enter a name to search for identities (or type 'exit' to quit)"
    if ($searchTerm -eq 'exit') { break }


    $results = Filter-Identities -identities $identities -searchTerm $searchTerm
    if ($results.Count -eq 0) {
        Write-Host "No identities found for '$searchTerm'" -ForegroundColor Red
        continue
    }


    Write-Host "Identities found:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $results.Count; $i++) {
        Write-Host "[$i] $($results[$i].DisplayName) (ID: $($results[$i].Id))"
    }



    $selection = Read-Host "Select a identity by number"
    if ($selection -notmatch '^\d+$' -or [int]$selection -ge $results.Count) {
        Write-Warning "Invalid selection"
        continue
    }


    $selectedIdentity = $results[$selection]
    Add-GraphScopes -spId $selectedIdentity.Id -displayName $selectedIdentity.DisplayName
}


Write-Host "Disconnecting from azure, goodbye!" -ForegroundColor Yellow
Disconnect-MgGraph