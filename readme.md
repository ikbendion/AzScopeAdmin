# AzScopeAdmin

## Overview
AzScopeAdmin is a PowerShell script for managing Azure service principals and assigning Microsoft Graph scopes. since its _still_ not easy in 2025!

## Prerequisites
- PowerShell
- Microsoft.Graph module

## Required Scopes
To use this script, the user signing in must have the following scopes:
- **Application.ReadWrite.All**: Required for managing service principals.
- **AppRoleAssignment.ReadWrite.All**: Necessary for assigning permissions to applications.
- **Directory.Read.All**: Required for reading directory data.

## Installation
Ensure the Microsoft.Graph module is installed, you must be able to install modules for this script to work

## Usage
1. Run the script to fetch service principals.
2. Search for identities by name.
3. Select an identity to assign Graph scopes.
4. Enter the required scopes, press enter two times when done
5. The Azure portal will open up, navigate to permissions to verify assignment.
6. Consent if nessecary.
7. End the script, it will sign out after each usage.

## License
This project is licensed under the MIT license.