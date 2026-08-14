Microsoft To Do Grouper
========================

Version 0.1.0

Purpose
-------
Adds a small "Group tasks" selector to the Microsoft To Do web app.

Designators
-----------
$  Project
@  Person
!  Task Type

Put designators at the END of the task title.

Examples
--------
Send ROM estimate $Montreal West @Brent !Email
Create requisition $Aloha !Requisition
Discuss contractor strategy $Bulk Plants @Tim !Discussion
Review fire protection proposal $Rochester !Review

Installation in Microsoft Edge / Chrome
---------------------------------------
1. Unzip this folder.
2. Open your browser's Extensions page.
3. Enable Developer mode.
4. Choose "Load unpacked".
5. Select the unzipped "ms-todo-grouper" folder.
6. Open or refresh Microsoft To Do.
7. Use the "Group tasks" selector in the upper-right.

Notes
-----
- This extension does not call Microsoft Graph and does not store your task data.
- It reads the task titles already rendered in the browser and changes their visual order.
- The selected grouping mode is stored locally by the extension.
- If Microsoft changes the To Do web page DOM, selectors may need to be updated.
- This first version groups tasks inside To Do's currently rendered list chunk(s).
