/* Tasklog frontend. All server communication lives in the API section below. */
const statuses = ["pending", "in_progress", "completed"];
const statusLabels = { pending: "To do", in_progress: "In progress", completed: "Completed" };
const priorityLabels = { low: "Low", medium: "Medium", high: "High" };
let tasks = [];
let allTasks = [];
let projects = [];
let editingId = null;
let editingProjectId = null;
let activeProjectId = null;
let currentView = "board";
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarTasks = [];
let calendarRequestId = 0;
let activeTaskId = null;
let currentUser = null;
let settings = { defaultPriority: "medium", showCompletedTasks: true };
let notificationRequestId = 0;
let toastTimer;
let pendingNoteFiles = [];
let previewObjectUrls = [];
let pendingAttachmentNoteId = null;
let noteFileSelectionId = 0;
let createSuggestions = [];
let detailSuggestions = [];

// API DATA ACCESS — keep all fetch calls and endpoint details in this section.
async function apiRequest(url, options) {
  const config = Object.assign({ credentials: "same-origin", headers: {} }, options || {});
  if (config.body && typeof config.body !== "string" && !(config.body instanceof FormData)) {
    config.headers["Content-Type"] = "application/json";
    config.body = JSON.stringify(config.body);
  }
  const response = await fetch(url, config);
  const payload = response.status === 204 ? null : await response.json().catch(function () { return {}; });
  if (!response.ok) {
    const error = new Error(payload && payload.error ? payload.error : "Request failed. Please try again.");
    error.status = response.status;
    throw error;
  }
  return payload;
}
const api = {
  me: function () { return apiRequest("/api/auth/me"); },
  login: function (body) { return apiRequest("/api/auth/login", { method: "POST", body: body }); },
  register: function (body) { return apiRequest("/api/auth/register", { method: "POST", body: body }); },
  logout: function () { return apiRequest("/api/auth/logout", { method: "POST" }); },
  // Lists tasks with optional project, date, status, priority, and search filters.
  listTasks: function (projectId, dateRange, filters) {
    const parameters = new URLSearchParams();
    if (projectId != null) parameters.set("projectId", projectId);
    if (dateRange && dateRange.from) parameters.set("from", dateRange.from);
    if (dateRange && dateRange.to) parameters.set("to", dateRange.to);
    if (filters && filters.status) parameters.set("status", filters.status);
    if (filters && filters.priority) parameters.set("priority", filters.priority);
    if (filters && filters.search) parameters.set("search", filters.search);
    const query = parameters.toString();
    return apiRequest("/api/tasks" + (query ? "?" + query : ""));
  },
  getStatsSummary: function () { return apiRequest("/api/stats/summary"); },
  getStatsActivity: function (days) { return apiRequest("/api/stats/activity?days=" + encodeURIComponent(days)); },
  getStatsStreak: function () { return apiRequest("/api/stats/streak"); },
  listProjects: function () { return apiRequest("/api/projects"); },
  createProject: function (body) { return apiRequest("/api/projects", { method: "POST", body: body }); },
  updateProject: function (id, body) { return apiRequest("/api/projects/" + id, { method: "PATCH", body: body }); },
  deleteProject: function (id) { return apiRequest("/api/projects/" + id, { method: "DELETE" }); },
  updateMyName: function (body) { return apiRequest("/api/users/me", { method: "PATCH", body: body }); },
  changeMyPassword: function (body) { return apiRequest("/api/users/me/password", { method: "POST", body: body }); },
  deleteMyAccount: function (body) { return apiRequest("/api/users/me", { method: "DELETE", body: body }); },
  getMySettings: function () { return apiRequest("/api/users/me/settings"); },
  updateMySettings: function (body) { return apiRequest("/api/users/me/settings", { method: "PATCH", body: body }); },
  getNotifications: function () { return apiRequest("/api/notifications"); },
  suggestSteps: function (body) { return apiRequest("/api/ai/suggest-steps", { method: "POST", body: body }); },
  createTask: function (body) { return apiRequest("/api/tasks", { method: "POST", body: body }); },
  updateTask: function (id, body) { return apiRequest("/api/tasks/" + id, { method: "PATCH", body: body }); },
  deleteTask: function (id) { return apiRequest("/api/tasks/" + id, { method: "DELETE" }); },
  createStep: function (id, body) { return apiRequest("/api/tasks/" + id + "/steps", { method: "POST", body: body }); },
  updateStep: function (id, stepId, body) { return apiRequest("/api/tasks/" + id + "/steps/" + stepId, { method: "PATCH", body: body }); },
  deleteStep: function (id, stepId) { return apiRequest("/api/tasks/" + id + "/steps/" + stepId, { method: "DELETE" }); },
  createNote: function (id, body) { return apiRequest("/api/tasks/" + id + "/notes", { method: "POST", body: body }); },
  uploadAttachments: function (taskId, noteId, files) {
    const formData = new FormData();
    files.forEach(function (file) { formData.append("images", file); });
    return apiRequest("/api/tasks/" + taskId + "/notes/" + noteId + "/attachments", { method: "POST", body: formData });
  },
  deleteNote: function (id, noteId) { return apiRequest("/api/tasks/" + id + "/notes/" + noteId, { method: "DELETE" }); }
};
async function refreshTasks() {
  const result = await api.listTasks();
  allTasks = result.tasks || [];
  if (activeProjectId == null) tasks = allTasks;
  else {
    const filtered = await api.listTasks(activeProjectId);
    tasks = filtered.tasks || [];
  }
  renderOpenTaskCount();
  renderInboxTaskCount();
  await refreshProjects();
  renderNavigationState();
  renderBoard();
  renderDashboard();
  loadNotifications();
  if (currentView === "dashboard") loadDashboardStats();
  if (currentView === "calendar") loadCalendarTasks();
  if (activeTaskId != null) renderDetails();
}
// Loads the current user's projects and refreshes their sidebar rows.
async function refreshProjects() {
  const result = await api.listProjects();
  projects = result.projects || [];
  renderProjectList();
}
// END API DATA ACCESS.

const projectColors = ["#2563EB", "#7C3AED", "#DB2777", "#DC2626", "#EA580C", "#CA8A04", "#16A34A", "#0891B2"];

// Shows how many tasks are still open in the full task list.
function renderOpenTaskCount() {
  const count = allTasks.filter(function (task) { return task.status !== "completed"; }).length;
  document.getElementById("open-task-count").textContent = count;
}

// Shows the number of tasks without a project in Inbox.
function renderInboxTaskCount() {
  const count = allTasks.filter(function (task) { return task.projectId == null; }).length;
  document.getElementById("inbox-task-count").textContent = count;
}

// Draws each project name, color dot, task count, and project menu in the sidebar.
function renderProjectList() {
  const list = document.getElementById("project-list");
  if (!list) return;
  list.innerHTML = projects.length ? projects.map(function (project) {
    return '<div class="project-item" data-project-row="' + project.id + '"><button type="button" class="project-select' + (String(activeProjectId) === String(project.id) ? " selected" : "") + '" data-project-select="' + project.id + '"><span class="project-dot" style="background-color:' + escapeHtml(project.color) + '"></span><span class="project-name">' + escapeHtml(project.name) + '</span><span class="project-count">' + project.taskCount + '</span></button><div class="project-menu-wrap"><button type="button" class="project-menu-trigger" data-project-menu="' + project.id + '" aria-label="Project options for ' + escapeHtml(project.name) + '" title="Project options">⋯</button><div class="project-menu" data-project-dropdown="' + project.id + '" hidden><button type="button" data-project-action="rename" data-id="' + project.id + '">Rename project</button><button type="button" class="project-delete" data-project-action="delete" data-id="' + project.id + '">Delete project</button></div></div></div>';
  }).join("") : '<p class="project-empty">No projects yet</p>';
}

// Updates the active sidebar item, page heading, and visible main section.
function renderNavigationState() {
  document.querySelectorAll("[data-view]").forEach(function (link) {
    link.classList.toggle("active", link.dataset.view === currentView && (currentView === "calendar" || activeProjectId == null));
  });
  document.querySelectorAll("[data-project-select]").forEach(function (link) {
    link.classList.toggle("selected", String(link.dataset.projectSelect) === String(activeProjectId));
  });
  board.hidden = currentView !== "board";
  document.getElementById("dashboard-view").hidden = currentView !== "dashboard";
  document.getElementById("reports-view").hidden = currentView !== "reports";
  document.getElementById("calendar-view").hidden = currentView !== "calendar";
  document.getElementById("profile-view").hidden = currentView !== "profile";
  document.getElementById("settings-view").hidden = currentView !== "settings";
  document.querySelector(".toolbar").hidden = currentView !== "board" && currentView !== "calendar";
  document.getElementById("create-task").hidden = currentView === "profile" || currentView === "settings";
  if (currentView === "dashboard") document.getElementById("page-title").textContent = "Dashboard";
  else if (currentView === "reports") document.getElementById("page-title").textContent = "Reports";
  else if (currentView === "calendar") document.getElementById("page-title").textContent = "Calendar";
  else if (currentView === "profile") document.getElementById("page-title").textContent = "Profile";
  else if (currentView === "settings") document.getElementById("page-title").textContent = "Settings";
  else if (activeProjectId === "inbox") document.getElementById("page-title").textContent = "Inbox";
  else if (activeProjectId != null) {
    const project = projects.find(function (item) { return String(item.id) === String(activeProjectId); });
    document.getElementById("page-title").textContent = project ? project.name : "My tasks";
  } else document.getElementById("page-title").textContent = "My tasks";
  const title = document.getElementById("page-title").textContent;
  document.title = title + " · Tasklog";
  const subtitles = { board: "A clear place to plan and finish your work.", dashboard: "A quick view of progress and upcoming work.", reports: "A printable record of completed work.", calendar: "Tasks arranged by their due dates.", profile: "Update your name and account security.", settings: "Set the defaults that work for you." };
  const activeProject = projects.find(function (item) { return String(item.id) === String(activeProjectId); });
  document.getElementById("page-subtitle").textContent = activeProjectId != null && activeProjectId !== "inbox" && activeProject ? activeProject.name + " project" : (subtitles[currentView] || "Tasks for this project.");
}

// Opens the task board for a project or Inbox and remembers that selection in the URL.
async function navigateToProject(projectId, updateUrl) {
  activeProjectId = projectId;
  currentView = "board";
  renderNavigationState();
  closeSidebarDrawer();
  if (updateUrl !== false) window.location.hash = projectId == null ? "board" : projectId === "inbox" ? "inbox" : "project/" + projectId;
  try {
    await refreshTasks();
  } catch (error) {
    reportError(error);
  }
}

// Opens the dashboard and clears any project filter from the URL.
function navigateToDashboard(updateUrl) {
  currentView = "dashboard";
  activeProjectId = null;
  tasks = allTasks;
  renderNavigationState();
  closeSidebarDrawer();
  if (updateUrl !== false) window.location.hash = "dashboard";
  renderDashboard();
  loadDashboardStats();
}

// Opens the reports page and loads its date range, project totals, and work timeline.
function navigateToReports(updateUrl) {
  currentView = "reports";
  activeProjectId = null;
  tasks = allTasks;
  renderNavigationState();
  closeSidebarDrawer();
  if (updateUrl !== false) window.location.hash = "reports";
  loadReports();
}

// Opens the calendar while keeping the current project filter selected.
function navigateToCalendar(updateUrl) {
  currentView = "calendar";
  renderNavigationState();
  closeSidebarDrawer();
  if (updateUrl !== false) {
    const calendarHash = activeProjectId == null ? "calendar" : activeProjectId === "inbox" ? "calendar/inbox" : "calendar/project/" + activeProjectId;
    window.location.hash = calendarHash;
  }
  loadCalendarTasks();
}

// Opens an account page and leaves the project's task filter behind.
function navigateToAccountPage(page, updateUrl) {
  currentView = page;
  activeProjectId = null;
  tasks = allTasks;
  renderNavigationState();
  closeSidebarDrawer();
  if (updateUrl !== false) window.location.hash = page;
  if (page === "settings") loadMySettings();
}

// Restores My Tasks, Inbox, Dashboard, or a project from the current URL hash.
async function restoreNavigationFromHash() {
  const hash = window.location.hash.slice(1);
  if (hash === "dashboard") {
    if (currentView !== "dashboard") navigateToDashboard(false);
    return;
  }
  if (hash === "reports") {
    if (currentView !== "reports") navigateToReports(false);
    return;
  }
  if (hash === "calendar" || hash.indexOf("calendar/") === 0) {
    if (hash === "calendar/inbox") activeProjectId = "inbox";
    else if (hash.indexOf("calendar/project/") === 0) {
      const projectId = hash.slice("calendar/project/".length);
      activeProjectId = projects.some(function (project) { return String(project.id) === projectId; }) ? projectId : null;
    } else activeProjectId = null;
    if (currentView !== "calendar") navigateToCalendar(false);
    else renderNavigationState();
    return;
  }
  if (hash === "profile" || hash === "settings") {
    if (currentView !== hash) navigateToAccountPage(hash, false);
    return;
  }
  if (hash === "inbox") {
    if (currentView !== "board" || activeProjectId !== "inbox") await navigateToProject("inbox", false);
    return;
  }
  if (hash.indexOf("project/") === 0) {
    const projectId = hash.slice("project/".length);
    if (projects.some(function (project) { return String(project.id) === projectId; })) {
      if (currentView !== "board" || String(activeProjectId) !== projectId) await navigateToProject(projectId, false);
      return;
    }
  }
  if (currentView !== "board" || activeProjectId != null) await navigateToProject(null, false);
}

// Opens or closes the sidebar drawer and updates its accessibility state.
function setSidebarDrawerOpen(isOpen) {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("sidebar-toggle");
  sidebar.classList.toggle("open", isOpen);
  document.getElementById("sidebar-backdrop").hidden = !isOpen;
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
}

// Closes the mobile sidebar drawer.
function closeSidebarDrawer() {
  setSidebarDrawerOpen(false);
}

// Finds a task in the active view or the full list used by the calendar and reports.
function findTask(id) { return tasks.concat(allTasks, calendarTasks).find(function (task) { return String(task.id) === String(id); }); }
function escapeHtml(value) { const el = document.createElement("span"); el.textContent = String(value == null ? "" : value); return el.innerHTML; }
function todayString() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function formatDate(value) { if (!value) return "No due date"; return new Date(String(value).slice(0, 10) + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
function formatDateTime(value) { return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
function getProgress(task) { if (!task.steps.length) return task.status === "completed" ? 100 : task.status === "in_progress" ? 50 : 0; return Math.round(task.steps.filter(function (s) { return s.done; }).length / task.steps.length * 100); }
function isOverdue(task) { return Boolean(task.dueDate && String(task.dueDate).slice(0, 10) < todayString() && task.status !== "completed"); }

function getVisibleTasks() {
  const query = document.getElementById("search").value.trim().toLowerCase();
  const status = document.getElementById("filter-status").value;
  const priority = document.getElementById("filter-priority").value;
  return tasks.filter(function (t) { return (settings.showCompletedTasks || t.status !== "completed") && (!query || (t.title + " " + t.description).toLowerCase().includes(query)) && (!status || t.status === status) && (!priority || t.priority === priority); });
}
function cardStepsHtml(task) {
  const steps = task.steps.slice(0, 3);
  return steps.length ? '<div class="card-steps">' + steps.map(function (s) { return '<label class="card-step"><input type="checkbox" data-step-task="' + task.id + '" data-step="' + s.id + '" ' + (s.done ? "checked" : "") + '><span class="' + (s.done ? "step-done" : "") + '">' + escapeHtml(s.text) + '</span></label>'; }).join("") + (task.steps.length > 3 ? '<small class="muted">+' + (task.steps.length - 3) + ' more</small>' : "") + '</div>' : "";
}
// Builds one task card with its actions, steps, priority and due date.
function createCard(task) {
  const action = task.status === "pending" ? ["start", "Start task"] : task.status === "in_progress" ? ["done", "Mark complete"] : ["reopen", "Reopen task"];
  const description = task.description || "No description";
  const projectTag = activeProjectId == null && task.projectId != null
    ? '<span class="project-tag"><i style="background-color:' + escapeHtml(task.projectColor) + '"></i>' + escapeHtml(task.projectName) + '</span>'
    : "";
  return '<article class="card priority-' + task.priority + '" draggable="true" data-card-id="' + task.id + '" tabindex="0"><div class="card-top"><div class="card-labels"><span class="tag ' + task.priority + '">' + priorityLabels[task.priority] + '</span>' + projectTag + '</div><div class="menu-wrap"><button class="menu-trigger" data-menu="' + task.id + '" aria-label="Task menu">⋯</button><div class="dropdown" data-dropdown="' + task.id + '" hidden><button data-action="open" data-id="' + task.id + '">Open details</button><button data-action="edit" data-id="' + task.id + '">Edit</button><button data-action="' + action[0] + '" data-id="' + task.id + '">' + action[1] + '</button><button class="delete-action" data-action="delete" data-id="' + task.id + '">Delete</button></div></div></div><h3>' + escapeHtml(task.title) + '</h3><p class="card-description">' + escapeHtml(description) + '</p>' + cardStepsHtml(task) + '<div class="card-meta"><span>' + task.steps.filter(function (s) { return s.done; }).length + '/' + task.steps.length + ' steps</span><time class="' + (isOverdue(task) ? "overdue" : "") + '">' + escapeHtml(formatDate(task.dueDate)) + '</time></div></article>';
}
function renderBoard() {
  const visible = getVisibleTasks();
  statuses.forEach(function (status) {
    const list = visible.filter(function (task) { return task.status === status; });
    document.getElementById("count-" + status).textContent = list.length;
    document.getElementById("list-" + status).innerHTML = list.length ? list.map(createCard).join("") : '<div class="empty"><span>' + (document.getElementById("search").value ? "No matching tasks" : "Nothing here yet. Add a task to get started.") + '</span>' + (document.getElementById("search").value ? "" : '<button type="button" class="text-button" data-empty-create>+ Create a task</button>') + '</div>';
  });
}

// Formats local date parts without converting a date-only task value through UTC.
function formatLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

// Moves a local calendar date by whole days, including across month boundaries.
function moveLocalDate(date, amount) {
  const moved = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  moved.setDate(moved.getDate() + amount);
  return moved;
}

// Gets the Monday-to-Sunday six-week range displayed in the month grid.
function getCalendarGridRange() {
  const firstOfMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const daysFromMonday = (firstOfMonth.getDay() + 6) % 7;
  const fromDate = moveLocalDate(firstOfMonth, -daysFromMonday);
  const toDate = moveLocalDate(fromDate, 41);
  return { from: formatLocalDateKey(fromDate), to: formatLocalDateKey(toDate) };
}

// Loads only dated tasks in the visible calendar range and applies the active filters.
async function loadCalendarTasks() {
  const requestId = ++calendarRequestId;
  const state = document.getElementById("calendar-state");
  const error = document.getElementById("calendar-error");
  state.hidden = false;
  state.textContent = "Loading this month…";
  error.hidden = true;
  document.getElementById("calendar-grid").innerHTML = "";
  document.getElementById("calendar-agenda").innerHTML = "";
  document.getElementById("calendar-agenda").hidden = true;
  const range = getCalendarGridRange();
  const projectLabel = activeProjectId === "inbox" ? "Inbox" : projects.find(function (project) { return String(project.id) === String(activeProjectId); });
  document.getElementById("calendar-filter-note").textContent = projectLabel ? "Project: " + (typeof projectLabel === "string" ? projectLabel : projectLabel.name) : "All projects";
  try {
    const filters = {
      status: document.getElementById("filter-status").value,
      priority: document.getElementById("filter-priority").value,
      search: document.getElementById("search").value.trim()
    };
    const result = await api.listTasks(activeProjectId, range, filters);
    if (requestId !== calendarRequestId) return;
    calendarTasks = result.tasks || [];
    state.hidden = true;
    renderCalendar();
  } catch (requestError) {
    if (requestId !== calendarRequestId) return;
    state.hidden = true;
    error.textContent = "Could not load calendar tasks. " + (requestError.message || "Please try again.");
    error.hidden = false;
  }
}

// Renders the six-week month grid and the matching narrow-screen day agenda.
function renderCalendar() {
  const grid = document.getElementById("calendar-grid");
  const agenda = document.getElementById("calendar-agenda");
  const range = getCalendarGridRange();
  const startParts = range.from.split("-").map(Number);
  const start = new Date(startParts[0], startParts[1] - 1, startParts[2]);
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  document.getElementById("calendar-month-title").textContent = calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const tasksByDate = {};
  calendarTasks.forEach(function (task) {
    const key = String(task.dueDate || "").slice(0, 10);
    if (!tasksByDate[key]) tasksByDate[key] = [];
    tasksByDate[key].push(task);
  });
  grid.innerHTML = Array.from({ length: 42 }, function (_, index) {
    const date = moveLocalDate(start, index);
    const dateKey = formatLocalDateKey(date);
    const dayTasks = (tasksByDate[dateKey] || []).slice().sort(function (first, second) { return first.title.localeCompare(second.title); });
    const chips = dayTasks.slice(0, 3).map(calendarTaskChipHtml).join("");
    const more = dayTasks.length > 3 ? '<details class="calendar-more"><summary>+' + (dayTasks.length - 3) + ' more</summary><div class="calendar-more-popover">' + dayTasks.slice(3).map(calendarTaskChipHtml).join("") + '</div></details>' : "";
    const classes = ["calendar-day"];
    if (date.getMonth() !== month) classes.push("outside-month");
    if (dateKey === todayString()) classes.push("is-today");
    return '<div class="' + classes.join(" ") + '" data-calendar-date="' + dateKey + '"><div class="calendar-day-head"><button type="button" class="calendar-day-number" data-calendar-create="' + dateKey + '" aria-label="Create a task due ' + escapeHtml(date.toLocaleDateString()) + '">' + date.getDate() + '</button></div><div class="calendar-day-tasks">' + chips + more + '</div></div>';
  }).join("");
  renderCalendarAgenda(tasksByDate, year, month);
}

// Builds one safe task chip with its project color and overdue state.
function calendarTaskChipHtml(task) {
  const color = task.projectColor || "#9aa1b1";
  const overdue = task.status !== "completed" && String(task.dueDate).slice(0, 10) < todayString();
  return '<button type="button" draggable="true" class="calendar-task-chip' + (overdue ? " overdue" : "") + '" data-calendar-task="' + task.id + '" title="' + escapeHtml(task.title) + '" style="--calendar-project-color:' + escapeHtml(color) + '"><span class="calendar-task-dot"></span><span>' + escapeHtml(task.title) + '</span></button>';
}

// Groups this month's dated tasks into the agenda shown on narrow screens.
function renderCalendarAgenda(tasksByDate, year, month) {
  const agenda = document.getElementById("calendar-agenda");
  agenda.hidden = false;
  const dayCount = new Date(year, month + 1, 0).getDate();
  agenda.innerHTML = Array.from({ length: dayCount }, function (_, index) {
    const date = new Date(year, month, index + 1);
    const dateKey = formatLocalDateKey(date);
    const items = (tasksByDate[dateKey] || []).slice().sort(function (first, second) { return first.title.localeCompare(second.title); });
    const rows = items.length ? items.map(calendarTaskChipHtml).join("") : '<p class="agenda-no-tasks">No tasks due</p>';
    return '<section class="agenda-day' + (dateKey === todayString() ? " is-today" : "") + '" data-calendar-date="' + dateKey + '"><header><span>' + escapeHtml(date.toLocaleDateString(undefined, { weekday: "short" })) + '</span><button type="button" class="agenda-date-create" data-calendar-create="' + dateKey + '" aria-label="Create task due ' + escapeHtml(date.toLocaleDateString()) + '">' + date.getDate() + '</button></header><div class="agenda-day-tasks">' + rows + '</div></section>';
  }).join("");
}

// Changes the displayed month and fetches its due tasks again.
function changeCalendarMonth(amount) {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + amount, 1);
  loadCalendarTasks();
}

// Updates a task date optimistically and restores the old date if saving fails.
async function moveCalendarTask(taskId, dueDate) {
  const task = findTask(taskId);
  if (!task || String(task.dueDate).slice(0, 10) === dueDate) return;
  const previousDueDate = task.dueDate;
  [tasks, allTasks, calendarTasks].forEach(function (list) {
    const match = list.find(function (item) { return String(item.id) === String(taskId); });
    if (match) match.dueDate = dueDate;
  });
  renderCalendar();
  try {
    await api.updateTask(taskId, { dueDate: dueDate });
  } catch (requestError) {
    [tasks, allTasks, calendarTasks].forEach(function (list) {
      const match = list.find(function (item) { return String(item.id) === String(taskId); });
      if (match) match.dueDate = previousDueDate;
    });
    renderCalendar();
    showToast("Could not move task. " + (requestError.message || "The original date was restored."));
    return;
  }
  await refreshTasks().catch(reportError);
}

// Draws the dashboard's upcoming tasks from the already-loaded task list.
function renderDashboard() {
  if (!document.getElementById("due-soon-list")) return;
  const upcoming = allTasks.filter(function (task) {
    return task.dueDate && String(task.dueDate).slice(0, 10) >= todayString() && task.status !== "completed";
  }).sort(function (first, second) {
    return String(first.dueDate).localeCompare(String(second.dueDate));
  }).slice(0, 5);
  const list = document.getElementById("due-soon-list");
  list.innerHTML = upcoming.length ? upcoming.map(function (task) {
    return '<button class="dashboard-task" data-dashboard-task="' + task.id + '"><span class="dashboard-task-title">' + escapeHtml(task.title) + '</span><span class="dashboard-task-meta">' + statusLabels[task.status] + ' · ' + escapeHtml(formatDate(task.dueDate)) + '</span></button>';
  }).join("") : '<p class="muted dashboard-empty">No upcoming tasks. Add a due date to a task to see it here.</p>';
}

// Loads the dashboard summary, chart data, and streak independently.
function loadDashboardStats() {
  loadDashboardSummary();
  loadDashboardActivity();
  loadDashboardStreak();
}

// Loads task totals and updates the dashboard cards and completion ring.
async function loadDashboardSummary() {
  const state = document.getElementById("summary-state");
  const error = document.getElementById("summary-error");
  const completionError = document.getElementById("completion-error");
  state.hidden = false;
  state.textContent = "Loading your task summary…";
  error.hidden = true;
  completionError.hidden = true;
  try {
    const result = await api.getStatsSummary();
    const summary = result.summary;
    document.getElementById("stat-total").textContent = summary.total;
    document.getElementById("stat-progress").textContent = summary.inProgress;
    document.getElementById("stat-completed").textContent = summary.completed;
    document.getElementById("stat-overdue").textContent = summary.overdue;
    document.getElementById("stat-due-today").textContent = summary.dueToday;
    document.getElementById("stat-due-week").textContent = summary.dueThisWeek;
    document.getElementById("stat-completed-week").textContent = summary.completedThisWeek;
    const rate = Number(summary.completionRate) || 0;
    const ring = document.getElementById("completion-ring");
    document.getElementById("completion-progress").style.strokeDashoffset = String(307.876 * (1 - rate / 100));
    ring.setAttribute("aria-label", rate + "% of tasks completed");
    document.getElementById("completion-rate").textContent = rate + "%";
    document.getElementById("completion-note").textContent = summary.total ? "" : "Create a task to start tracking progress.";
    state.hidden = true;
  } catch (requestError) {
    ["stat-total", "stat-progress", "stat-completed", "stat-overdue", "stat-due-today", "stat-due-week", "stat-completed-week", "completion-rate"].forEach(function (id) {
      document.getElementById(id).textContent = "—";
    });
    document.getElementById("completion-progress").style.strokeDashoffset = "307.876";
    state.hidden = true;
    error.textContent = "Could not load your task summary. " + (requestError.message || "Please try again.");
    error.hidden = false;
    completionError.textContent = "Could not load the completion rate. " + (requestError.message || "Please try again.");
    completionError.hidden = false;
    document.getElementById("completion-note").textContent = "";
  }
}

// Loads the last 14 days and draws a stacked SVG activity chart.
async function loadDashboardActivity() {
  const state = document.getElementById("activity-state");
  const error = document.getElementById("activity-error");
  const empty = document.getElementById("activity-empty");
  const chart = document.getElementById("activity-chart-wrap");
  state.hidden = false;
  state.textContent = "Loading activity…";
  error.hidden = true;
  empty.hidden = true;
  chart.hidden = true;
  try {
    const result = await api.getStatsActivity(14);
    const activity = result.days || [];
    const total = activity.reduce(function (sum, day) {
      return sum + Number(day.stepsTicked) + Number(day.tasksCompleted) + Number(day.notesAdded);
    }, 0);
    state.hidden = true;
    if (!total) {
      empty.hidden = false;
      return;
    }
    chart.innerHTML = buildDashboardActivitySvg(activity);
    chart.hidden = false;
  } catch (requestError) {
    state.hidden = true;
    error.textContent = "Could not load activity. " + (requestError.message || "Please try again.");
    error.hidden = false;
  }
}

// Builds safe SVG bars from the aggregated activity values returned by the API.
function buildDashboardActivitySvg(days) {
  const chartHeight = 112;
  const chartBottom = 140;
  const slotWidth = 48;
  const maxTotal = Math.max.apply(null, days.map(function (day) {
    return Number(day.stepsTicked) + Number(day.tasksCompleted) + Number(day.notesAdded);
  }));
  const bars = days.map(function (day, index) {
    const values = [Number(day.stepsTicked), Number(day.tasksCompleted), Number(day.notesAdded)];
    const colors = ["var(--accent)", "var(--done)", "var(--medium)"];
    const x = 38 + index * slotWidth;
    let y = chartBottom;
    const segments = values.map(function (value, segmentIndex) {
      const height = value ? Math.max(2, value / maxTotal * chartHeight) : 0;
      y -= height;
      return height ? '<rect x="' + (x + 7) + '" y="' + y.toFixed(1) + '" width="22" height="' + height.toFixed(1) + '" rx="3" fill="' + colors[segmentIndex] + '"></rect>' : "";
    }).join("");
    const dateLabel = new Date(day.date + "T00:00:00").toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
    const title = dateLabel + ": " + values[0] + " steps, " + values[1] + " tasks, " + values[2] + " notes";
    return '<g><title>' + escapeHtml(title) + '</title>' + segments + '<text x="' + (x + 18) + '" y="164" text-anchor="middle">' + escapeHtml(dateLabel) + '</text></g>';
  }).join("");
  return '<svg class="dashboard-activity-chart" viewBox="0 0 720 178" role="img" aria-label="Activity during the last 14 days"><line x1="30" y1="' + chartBottom + '" x2="710" y2="' + chartBottom + '" stroke="#e7e9ee"></line>' + bars + '</svg>';
}

// Loads the current completion streak and shows a friendly zero-data message.
async function loadDashboardStreak() {
  const state = document.getElementById("streak-state");
  const error = document.getElementById("streak-error");
  state.hidden = false;
  state.textContent = "Loading your streak…";
  error.hidden = true;
  try {
    const result = await api.getStatsStreak();
    const streak = result.streak;
    const days = Number(streak.currentStreak) || 0;
    document.getElementById("streak-days").textContent = days;
    document.getElementById("streak-note").textContent = days ? "Last active " + formatDate(streak.lastActiveDate) : "Complete a task or step today to start a streak.";
    state.hidden = true;
  } catch (requestError) {
    document.getElementById("streak-days").textContent = "—";
    state.hidden = true;
    error.textContent = "Could not load your streak. " + (requestError.message || "Please try again.");
    error.hidden = false;
  }
}

// Loads each report section separately so one failed request does not hide the others.
function loadReports() {
  loadReportActivity();
  loadReportProjects();
  loadReportProof();
}

// Fetches the selected date range and draws its daily activity as plain SVG.
async function loadReportActivity() {
  const state = document.getElementById("report-activity-state");
  const error = document.getElementById("report-activity-error");
  const empty = document.getElementById("report-activity-empty");
  const chart = document.getElementById("report-activity-chart");
  state.hidden = false;
  state.textContent = "Loading activity…";
  error.hidden = true;
  empty.hidden = true;
  chart.hidden = true;
  try {
    const result = await api.getStatsActivity(document.getElementById("report-days").value);
    const days = result.days || [];
    const total = days.reduce(function (sum, day) {
      return sum + Number(day.stepsTicked) + Number(day.tasksCompleted) + Number(day.notesAdded);
    }, 0);
    state.hidden = true;
    if (!total) { empty.hidden = false; return; }
    chart.innerHTML = buildReportActivitySvg(days);
    chart.hidden = false;
  } catch (requestError) {
    state.hidden = true;
    error.textContent = "Could not load report activity. " + (requestError.message || "Please try again.");
    error.hidden = false;
  }
}

// Builds a horizontally scrollable stacked SVG chart for seven, thirty, or ninety days.
function buildReportActivitySvg(days) {
  const width = Math.max(720, days.length * 22);
  const bottom = 132;
  const chartHeight = 96;
  const slot = (width - 36) / days.length;
  const maxTotal = Math.max(1, ...days.map(function (day) {
    return Number(day.stepsTicked) + Number(day.tasksCompleted) + Number(day.notesAdded);
  }));
  const bars = days.map(function (day, index) {
    const values = [Number(day.stepsTicked), Number(day.tasksCompleted), Number(day.notesAdded)];
    const colors = ["var(--accent)", "var(--done)", "var(--medium)"];
    const x = 18 + index * slot;
    let y = bottom;
    const segments = values.map(function (value, segmentIndex) {
      const height = value ? Math.max(2, value / maxTotal * chartHeight) : 0;
      y -= height;
      return height ? '<rect x="' + (x + slot * .2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (slot * .6).toFixed(1) + '" height="' + height.toFixed(1) + '" rx="2" fill="' + colors[segmentIndex] + '"></rect>' : "";
    }).join("");
    const label = new Date(day.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const showLabel = days.length <= 14 || index % Math.ceil(days.length / 14) === 0;
    const title = label + ": " + values[0] + " steps, " + values[1] + " tasks, " + values[2] + " notes";
    return '<g><title>' + escapeHtml(title) + '</title>' + segments + (showLabel ? '<text x="' + (x + slot / 2).toFixed(1) + '" y="154" text-anchor="middle">' + escapeHtml(label) + '</text>' : "") + '</g>';
  }).join("");
  return '<svg class="report-activity-chart" viewBox="0 0 ' + width + ' 166" role="img" aria-label="Daily activity for the selected date range"><line x1="10" y1="' + bottom + '" x2="' + (width - 10) + '" y2="' + bottom + '" stroke="#e7e9ee"></line>' + bars + '</svg>';
}

// Fetches project totals and combines them with Inbox task counts for the breakdown.
async function loadReportProjects() {
  const state = document.getElementById("report-project-state");
  const error = document.getElementById("report-project-error");
  const list = document.getElementById("report-project-list");
  state.hidden = false;
  state.textContent = "Loading projects…";
  error.hidden = true;
  list.hidden = true;
  try {
    const result = await api.listProjects();
    const rows = [{ name: "Inbox", color: "#9aa1b1", taskCount: 0, completedCount: 0 }].concat(result.projects || []);
    const inboxTasks = allTasks.filter(function (task) { return task.projectId == null; });
    rows[0].taskCount = inboxTasks.length;
    rows[0].completedCount = inboxTasks.filter(function (task) { return task.status === "completed"; }).length;
    list.innerHTML = rows.length ? rows.map(function (project) {
      const completed = Number(project.completedCount) || 0;
      const total = Number(project.taskCount) || 0;
      const open = total - completed;
      return '<tr><td><span class="report-project-name"><span class="project-dot" style="background-color:' + escapeHtml(project.color) + '"></span>' + escapeHtml(project.name) + '</span></td><td>' + completed + '</td><td>' + open + '</td></tr>';
    }).join("") : '<tr><td colspan="3">No projects yet.</td></tr>';
    state.hidden = true;
    list.hidden = false;
  } catch (requestError) {
    state.hidden = true;
    error.textContent = "Could not load project totals. " + (requestError.message || "Please try again.");
    error.hidden = false;
  }
}

// Loads task history and notes, then displays completed steps and notes newest first.
async function loadReportProof() {
  const state = document.getElementById("report-proof-state");
  const error = document.getElementById("report-proof-error");
  const empty = document.getElementById("report-proof-empty");
  const list = document.getElementById("report-proof-list");
  state.hidden = false;
  state.textContent = "Loading your work history…";
  error.hidden = true;
  empty.hidden = true;
  list.hidden = true;
  try {
    const result = await api.listTasks();
    const events = [];
    const rangeStart = new Date();
    rangeStart.setHours(0, 0, 0, 0);
    rangeStart.setDate(rangeStart.getDate() - Number(document.getElementById("report-days").value) + 1);
    (result.tasks || []).forEach(function (task) {
      (task.history || []).forEach(function (item) {
        if (item.text.indexOf("Completed step:") === 0 && new Date(item.createdAt) >= rangeStart) {
          events.push({ title: item.text, taskTitle: task.title, createdAt: item.createdAt, kind: "Completed step" });
        }
      });
      (task.notes || []).forEach(function (note) {
        if (new Date(note.createdAt) >= rangeStart) {
          events.push({ title: note.text, taskTitle: task.title, createdAt: note.createdAt, kind: "Note added" });
        }
      });
    });
    events.sort(function (first, second) { return new Date(second.createdAt) - new Date(first.createdAt); });
    state.hidden = true;
    if (!events.length) { empty.hidden = false; return; }
    list.innerHTML = events.map(function (event) {
      return '<tr><td><span class="proof-kind">' + event.kind + '</span><div>' + escapeHtml(event.title) + '</div></td><td>' + escapeHtml(event.taskTitle) + '</td><td>' + event.kind + '</td><td><time datetime="' + escapeHtml(event.createdAt) + '">' + escapeHtml(formatDateTime(event.createdAt)) + '</time></td></tr>';
    }).join("");
    list.hidden = false;
  } catch (requestError) {
    state.hidden = true;
    error.textContent = "Could not load proof of work. " + (requestError.message || "Please try again.");
    error.hidden = false;
  }
}
// Shows a short message in a consistent place and styles errors separately.
function showToast(message, type) { const toast = document.getElementById("toast"); toast.textContent = message; toast.dataset.type = type || "success"; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 4000); }
// Turns request errors into a visible message instead of leaving the user guessing.
function reportError(error) { showToast(error && error.message ? error.message : "Something went wrong. Please try again.", "error"); }

// Loads the saved user preferences and applies them to the board and settings form.
async function loadMySettings() {
  const error = document.getElementById("settings-error");
  if (error) error.hidden = true;
  try {
    const result = await api.getMySettings();
    settings = result.settings;
    document.getElementById("default-priority").value = settings.defaultPriority;
    document.getElementById("show-completed-tasks").checked = settings.showCompletedTasks;
    renderBoard();
  } catch (requestError) {
    if (error) {
      error.textContent = "Could not load settings. " + (requestError.message || "Please try again.");
      error.hidden = false;
    }
  }
}

// Loads reminders from the server and updates the bell badge and task list.
async function loadNotifications() {
  const requestId = ++notificationRequestId;
  const state = document.getElementById("notification-state");
  const error = document.getElementById("notification-error");
  const list = document.getElementById("notification-list");
  state.hidden = false;
  state.textContent = "Loading reminders…";
  error.hidden = true;
  list.innerHTML = "";
  try {
    const result = await api.getNotifications();
    if (requestId !== notificationRequestId) return;
    const notifications = result.notifications || [];
    const badge = document.getElementById("notification-count");
    badge.textContent = notifications.length > 99 ? "99+" : String(notifications.length);
    badge.hidden = notifications.length === 0;
    state.hidden = true;
    list.innerHTML = notifications.length ? notifications.map(function (item) {
      const labels = { overdue: "Overdue", due_today: "Due today", due_soon: "Due soon" };
      return '<button type="button" class="notification-item ' + escapeHtml(item.type) + '" data-notification-task="' + item.taskId + '"><span class="notification-type">' + labels[item.type] + '</span><strong>' + escapeHtml(item.title) + '</strong><time>' + escapeHtml(formatDate(item.dueDate)) + '</time></button>';
    }).join("") : '<p class="notification-empty">You are all caught up.</p>';
  } catch (requestError) {
    if (requestId !== notificationRequestId) return;
    state.hidden = true;
    error.textContent = "Could not load notifications. " + (requestError.message || "Please try again.");
    error.hidden = false;
  }
}

// Closes the account menu and can return keyboard focus to its button.
function closeUserMenu(returnFocus) {
  const menu = document.getElementById("user-menu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  document.getElementById("user-menu-toggle").setAttribute("aria-expanded", "false");
  if (returnFocus) document.getElementById("user-menu-toggle").focus();
}

// Opens the account menu and keeps its expanded state accessible to assistive tools.
function toggleUserMenu() {
  const menu = document.getElementById("user-menu");
  const shouldOpen = menu.hidden;
  menu.hidden = !shouldOpen;
  document.getElementById("user-menu-toggle").setAttribute("aria-expanded", String(shouldOpen));
}

// Closes the account menu when the user clicks outside it.
function closeUserMenuOnOutsideClick(event) {
  const wrapper = document.getElementById("user-menu-wrap");
  if (wrapper && !wrapper.contains(event.target)) closeUserMenu(false);
}

// Closes the reminder dropdown and updates the bell's expanded state.
function closeNotificationMenu() {
  document.getElementById("notification-menu").hidden = true;
  document.getElementById("notification-toggle").setAttribute("aria-expanded", "false");
}

// Turns a user's name into initials for the profile avatar.
function getUserInitials(name) {
  const parts = String(name || "U").trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : (parts[0] || "U").slice(0, 2).toUpperCase();
}

// Updates all visible name and avatar labels after a profile change.
function renderUserIdentity() {
  if (!currentUser) return;
  document.getElementById("user-name").textContent = currentUser.name;
  document.getElementById("user-email").textContent = currentUser.email;
  document.getElementById("user-avatar").textContent = getUserInitials(currentUser.name);
  document.getElementById("user-avatar").setAttribute("aria-label", "Account menu for " + currentUser.name);
  document.getElementById("profile-name").value = currentUser.name;
  document.getElementById("profile-email").value = currentUser.email;
  document.getElementById("profile-avatar").textContent = getUserInitials(currentUser.name);
}

// Saves the profile name and shows validation or server errors beside the form.
async function saveProfileName(event) {
  event.preventDefault();
  const error = document.getElementById("profile-error");
  const message = document.getElementById("profile-message");
  error.hidden = true;
  message.hidden = true;
  try {
    const result = await api.updateMyName({ name: document.getElementById("profile-name").value.trim() });
    currentUser = result.user;
    renderUserIdentity();
    message.textContent = "Your name has been updated.";
    message.hidden = false;
  } catch (requestError) {
    error.textContent = requestError.message || "Could not update your name.";
    error.hidden = false;
  }
}

// Changes the password and keeps any incorrect-current-password error on the page.
async function saveNewPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.getElementById("password-error");
  const message = document.getElementById("password-message");
  error.hidden = true;
  message.hidden = true;
  try {
    const result = await api.changeMyPassword({ currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value });
    form.reset();
    message.textContent = result.message || "Password changed.";
    message.hidden = false;
  } catch (requestError) {
    error.textContent = requestError.message || "Could not change your password.";
    error.hidden = false;
  }
}

// Deletes the account only after the user enters DELETE and confirms their password.
async function deleteMyAccountFromProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.getElementById("delete-account-error");
  error.hidden = true;
  if (form.elements.confirmation.value !== "DELETE") {
    error.textContent = "Type DELETE exactly to confirm account removal.";
    error.hidden = false;
    form.elements.confirmation.focus();
    return;
  }
  if (!window.confirm("Permanently delete your account, tasks, projects, notes, and uploaded images?")) return;
  try {
    await api.deleteMyAccount({ password: form.elements.password.value });
    window.location.replace("login.html");
  } catch (requestError) {
    error.textContent = requestError.message || "Could not delete your account.";
    error.hidden = false;
  }
}

// Saves task preferences and immediately applies completed-task visibility.
async function saveTaskSettings(event) {
  event.preventDefault();
  const error = document.getElementById("settings-error");
  const message = document.getElementById("settings-message");
  error.hidden = true;
  message.hidden = true;
  try {
    const result = await api.updateMySettings({
      defaultPriority: document.getElementById("default-priority").value,
      showCompletedTasks: document.getElementById("show-completed-tasks").checked
    });
    settings = result.settings;
    renderBoard();
    message.textContent = "Your preferences have been saved.";
    message.hidden = false;
  } catch (requestError) {
    error.textContent = requestError.message || "Could not save settings.";
    error.hidden = false;
  }
}

// Opens or closes the bell menu and reloads reminders when opening it.
function toggleNotificationMenu() {
  const menu = document.getElementById("notification-menu");
  const shouldOpen = menu.hidden;
  menu.hidden = !shouldOpen;
  document.getElementById("notification-toggle").setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen) loadNotifications();
}

// Opens the existing task details panel after a reminder is clicked.
function openNotificationTask(event) {
  const taskButton = event.target.closest("[data-notification-task]");
  if (!taskButton) return;
  closeNotificationMenu();
  openDetails(taskButton.dataset.notificationTask);
}

// Closes the reminders menu when a click happens anywhere outside its wrapper.
function closeNotificationsOnOutsideClick(event) {
  if (!document.getElementById("notification-wrap").contains(event.target)) closeNotificationMenu();
}

// Saves the explicit dark or light choice made with the appearance checkbox.
function handleThemeToggle(event) {
  saveThemeMode(event.currentTarget.checked ? "dark" : "light");
}

// Reads a saved theme choice, using the device appearance when no choice exists.
function getThemeMode() {
  try { return localStorage.getItem("taskflow_theme") || "system"; }
  catch (error) { return "system"; }
}

// Applies a saved theme or returns to the operating system color preference.
function applyThemePreference() {
  const mode = getThemeMode();
  const root = document.documentElement;
  if (mode === "dark" || mode === "light") root.dataset.theme = mode;
  else delete root.dataset.theme;
  const toggle = document.getElementById("dark-mode-toggle");
  const systemPrefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (toggle) toggle.checked = mode === "dark" || (mode === "system" && systemPrefersDark);
}

// Saves the chosen theme mode or removes the choice to follow the device.
function saveThemeMode(mode) {
  try {
    if (mode === "system") localStorage.removeItem("taskflow_theme");
    else localStorage.setItem("taskflow_theme", mode);
  } catch (error) {}
  applyThemePreference();
}

const createOverlay = document.getElementById("create-overlay");
const projectOverlay = document.getElementById("project-overlay");
const taskForm = document.getElementById("task-form");
const projectForm = document.getElementById("project-form");
const detailsPanel = document.getElementById("details-panel");
const board = document.querySelector(".board");
// Fills the create and edit dropdown with Inbox and the user's projects.
function renderTaskProjectOptions(selectedProjectId) {
  const select = document.getElementById("task-project");
  select.innerHTML = '<option value="">Inbox (no project)</option>' + projects.map(function (project) {
    return '<option value="' + project.id + '">' + escapeHtml(project.name) + '</option>';
  }).join("");
  select.value = selectedProjectId == null ? "" : String(selectedProjectId);
}

function addStepInput(text, source) {
  const row = document.createElement("div"); row.className = "step-input-row"; row.dataset.source = source || "user";
  row.innerHTML = '<input type="text" aria-label="Step description" placeholder="Describe a step" value="' + escapeHtml(text || "") + '"><button type="button" class="step-remove" aria-label="Remove step">×</button>';
  document.getElementById("step-inputs").appendChild(row);
}

// Fills the project form with the fixed set of selectable colors.
function renderProjectColorOptions(selectedColor) {
  const options = document.getElementById("project-color-options");
  options.innerHTML = projectColors.map(function (color) {
    const selected = color === selectedColor;
    return '<button type="button" class="project-color-choice' + (selected ? " selected" : "") + '" data-project-color="' + color + '" style="--project-color:' + color + '" role="radio" aria-label="' + color + '" aria-checked="' + selected + '"></button>';
  }).join("");
  projectForm.elements.color.value = selectedColor;
}

// Opens the shared project dialog for a new project or an existing project.
function openProjectForm(project) {
  closeSidebarDrawer();
  editingProjectId = project ? project.id : null;
  projectForm.reset();
  projectForm.elements.name.value = project ? project.name : "";
  document.getElementById("project-form-title").textContent = project ? "Rename project" : "New project";
  document.getElementById("project-submit").textContent = project ? "Save changes" : "Create project";
  document.getElementById("project-error").hidden = true;
  renderProjectColorOptions(project ? project.color : projectColors[0]);
  projectOverlay.hidden = false;
  projectForm.elements.name.focus();
}

// Closes the project dialog without saving its current form values.
function closeProjectForm() {
  projectOverlay.hidden = true;
  editingProjectId = null;
}

// Saves the new or renamed project and reloads the sidebar counts.
async function saveProjectForm(event) {
  event.preventDefault();
  const wasEditing = editingProjectId != null;
  const submit = document.getElementById("project-submit");
  const error = document.getElementById("project-error");
  submit.disabled = true;
  error.hidden = true;
  try {
    const values = { name: projectForm.elements.name.value.trim(), color: projectForm.elements.color.value };
    if (editingProjectId) await api.updateProject(editingProjectId, values);
    else await api.createProject(values);
    closeProjectForm();
    await refreshTasks();
    showToast(wasEditing ? "Project updated" : "Project created");
  } catch (requestError) {
    error.textContent = requestError.message || "Could not save this project.";
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
}
// Displays AI suggestions separately so the user must choose which steps to add.
function renderAISuggestions(area, items, scope, message) {
  if (!area) return;
  area.hidden = false;
  area.innerHTML = (message ? '<p class="ai-feedback" role="status">' + escapeHtml(message) + ' <button type="button" class="text-button" data-ai-retry="' + scope + '">Try again</button></p>' : '') +
    (items.length ? '<div class="ai-chip-list">' + items.map(function (item, index) { return '<button type="button" class="suggestion-chip" data-ai-add="' + scope + '" data-ai-index="' + index + '">+ ' + escapeHtml(item) + '</button><button type="button" class="ai-dismiss" data-ai-dismiss="' + scope + '" data-ai-index="' + index + '" aria-label="Dismiss suggestion">×</button>'; }).join("") + '</div><button type="button" class="text-button" data-ai-add-all="' + scope + '">Add all</button><button type="button" class="text-button" data-ai-dismiss-all="' + scope + '">Dismiss all</button>' : (!message ? '<p class="ai-feedback">No new suggestions were returned.</p>' : ''));
}

// Requests suggestions for the task form or the currently open task.
async function requestAISuggestions(scope) {
  const createMode = scope === "create";
  const button = document.getElementById(createMode ? "suggest-steps" : "detail-suggest-steps");
  const area = document.getElementById(createMode ? "suggestions" : "detail-suggestions");
  const title = createMode ? taskForm.elements.title.value.trim() : (findTask(activeTaskId) || {}).title;
  const description = createMode ? taskForm.elements.description.value.trim() : ((findTask(activeTaskId) || {}).description || "");
  const existingSteps = createMode ? Array.from(document.querySelectorAll("#step-inputs input")).map(function (input) { return input.value.trim(); }).filter(Boolean) : ((findTask(activeTaskId) || {}).steps || []).map(function (step) { return step.text; });
  if (!title) { renderAISuggestions(area, [], scope, "Enter a task title first."); if (createMode) taskForm.elements.title.focus(); return; }
  if (title.length > 120 || description.length > 1000 || existingSteps.length > 20) {
    renderAISuggestions(area, [], scope, "AI suggestions need a title up to 120 characters, description up to 1,000, and no more than 20 steps."); return;
  }
  button.disabled = true;
  button.textContent = "Generating…";
  area.hidden = false;
  area.innerHTML = '<p class="ai-feedback" role="status">Generating suggestions…</p>';
  try {
    const result = await api.suggestSteps({ title: title, description: description, existingSteps: existingSteps });
    if (createMode) createSuggestions = result.suggestions || [];
    else detailSuggestions = result.suggestions || [];
    renderAISuggestions(area, createMode ? createSuggestions : detailSuggestions, scope);
  } catch (error) {
    renderAISuggestions(area, [], scope, error.message || "Suggestions are unavailable. Please try again.");
  } finally {
    button.disabled = false;
    button.textContent = "Suggest steps with AI";
  }
}

// Adds selected AI suggestions as editable checklist items.
async function addAISuggestions(scope, indexes) {
  const createMode = scope === "create";
  const items = createMode ? createSuggestions : detailSuggestions;
  const selected = indexes.map(function (index) { return items[index]; }).filter(Boolean);
  if (!selected.length) return;
  const button = document.querySelector('[data-ai-add-all="' + scope + '"]');
  if (button) { button.disabled = true; button.textContent = "Adding…"; }
  try {
    if (createMode) {
      selected.forEach(function (step) { addStepInput(step, "ai"); });
      createSuggestions = items.filter(function (_, index) { return !indexes.includes(index); });
      renderAISuggestions(document.getElementById("suggestions"), createSuggestions, scope);
    } else {
      const task = findTask(activeTaskId);
      for (const step of selected) await api.createStep(task.id, { text: step, source: "ai" });
      detailSuggestions = items.filter(function (_, index) { return !indexes.includes(index); });
      await refreshTasks();
      renderAISuggestions(document.getElementById("detail-suggestions"), detailSuggestions, scope);
    }
  } catch (error) {
    renderAISuggestions(document.getElementById(createMode ? "suggestions" : "detail-suggestions"), items, scope, error.message || "Could not add every step. Please try again.");
  } finally {
    const currentButton = document.querySelector('[data-ai-add-all="' + scope + '"]');
    if (currentButton) currentButton.disabled = false;
  }
}
// Opens the task form and optionally fills a due date chosen in the calendar.
function openCreateForm(defaultDueDate) {
  editingId = null; taskForm.reset(); document.getElementById("form-title").textContent = "Create task";
  if (typeof defaultDueDate === "string") taskForm.elements.dueDate.value = defaultDueDate;
  taskForm.elements.priority.value = settings.defaultPriority;
  renderTaskProjectOptions(activeProjectId === "inbox" ? null : activeProjectId);
  taskForm.querySelector('[type="submit"]').textContent = "Create task";
  document.getElementById("step-inputs").innerHTML = ""; document.getElementById("title-error").hidden = true;
  createSuggestions = []; document.getElementById("suggestions").hidden = true; addStepInput("", "user"); createOverlay.hidden = false; taskForm.elements.title.focus();
}
function openEditForm(id) {
  const task = findTask(id); if (!task) return;
  createSuggestions = []; document.getElementById("suggestions").hidden = true;
  editingId = task.id; taskForm.reset(); document.getElementById("form-title").textContent = "Edit task";
  taskForm.querySelector('[type="submit"]').textContent = "Save changes";
  taskForm.elements.title.value = task.title; taskForm.elements.description.value = task.description || "";
  taskForm.elements.priority.value = task.priority; taskForm.elements.dueDate.value = task.dueDate ? String(task.dueDate).slice(0, 10) : "";
  renderTaskProjectOptions(task.projectId);
  document.getElementById("step-inputs").innerHTML = ""; task.steps.forEach(function (s) { addStepInput(s.text, s.source); });
  if (!task.steps.length) addStepInput("", "user"); createOverlay.hidden = false;
}
function closeCreateForm() { createOverlay.hidden = true; editingId = null; taskForm.reset(); }
// Clears selected image previews and any retry state when leaving a task note form.
function clearPendingNoteImages() {
  noteFileSelectionId += 1;
  previewObjectUrls.forEach(function (url) { URL.revokeObjectURL(url); });
  previewObjectUrls = [];
  pendingNoteFiles = [];
  pendingAttachmentNoteId = null;
}

// Checks selected image bytes so the preview does not trust a browser MIME label.
async function isSupportedNoteImage(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every(function (value, index) { return bytes[index] === value; })) return true;
  return bytes.length >= 12 && String.fromCharCode.apply(null, bytes.slice(0, 4)) === "RIFF" && String.fromCharCode.apply(null, bytes.slice(8, 12)) === "WEBP";
}

// Draws selected image previews with a remove control for each file.
function renderPendingNotePreviews() {
  previewObjectUrls.forEach(function (url) { URL.revokeObjectURL(url); });
  previewObjectUrls = [];
  const area = document.getElementById("note-image-previews");
  if (!area) return;
  area.innerHTML = pendingNoteFiles.map(function (file, index) {
    const url = URL.createObjectURL(file);
    previewObjectUrls.push(url);
    return '<div class="attachment-preview"><img class="thumb" src="' + escapeHtml(url) + '" alt="Preview of ' + escapeHtml(file.name) + '"><button type="button" class="preview-remove" data-remove-note-file="' + index + '" aria-label="Remove ' + escapeHtml(file.name) + '">Remove</button></div>';
  }).join("");
}

// Opens the task details panel and starts with clean upload state when changing tasks.
function openDetails(id) {
  if (String(activeTaskId) !== String(id)) { clearPendingNoteImages(); detailSuggestions = []; }
  activeTaskId = id;
  renderDetails();
  detailsPanel.classList.add("open");
  detailsPanel.setAttribute("aria-hidden", "false");
  document.getElementById("panel-backdrop").hidden = false;
}

// Closes the task details panel and clears any unsaved image selections.
function closeDetails() {
  detailsPanel.classList.remove("open");
  detailsPanel.setAttribute("aria-hidden", "true");
  document.getElementById("panel-backdrop").hidden = true;
  activeTaskId = null;
  detailSuggestions = [];
  clearPendingNoteImages();
}

// Renders task details, note attachments, and the existing activity history.
function renderDetails() {
  const task = findTask(activeTaskId); if (!task) return;
  const notes = task.notes.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  const noteHtml = notes.length ? notes.map(function (n) {
    const attachments = (n.attachments || []).map(function (attachment) {
      return '<img class="thumb saved-attachment" src="' + escapeHtml(attachment.url) + '" alt="' + escapeHtml(attachment.name) + '" data-image="' + escapeHtml(attachment.url) + '" loading="lazy">';
    }).join("");
    return '<article class="timeline-entry"><p>' + escapeHtml(n.text) + '</p><div class="saved-attachments">' + attachments + '</div><time>' + escapeHtml(formatDateTime(n.createdAt)) + '</time></article>';
  }).join("") : '<p class="muted">Notes will appear here.</p>';
  const history = task.history.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  const historyHtml = history.length ? history.map(function (h) { return '<p>' + escapeHtml(h.text) + '<time>' + escapeHtml(formatDateTime(h.createdAt)) + '</time></p>'; }).join("") : '<p class="muted">No history yet.</p>';
  document.getElementById("details-content").innerHTML =
    '<div class="detail-title-row"><h2>' + escapeHtml(task.title) + '</h2><div class="detail-actions"><button class="btn" data-detail-edit="' + task.id + '">Edit</button></div></div>' +
    '<div class="detail-meta"><span class="status-pill ' + (task.status === "completed" ? "completed" : "") + '">' + statusLabels[task.status] + '</span><span class="tag ' + task.priority + '">' + priorityLabels[task.priority] + '</span><span class="detail-due ' + (isOverdue(task) ? "overdue" : "") + '">Due ' + escapeHtml(formatDate(task.dueDate)) + '</span></div>' +
    '<p class="detail-description">' + escapeHtml(task.description || "No description added.") + '</p>' +
    '<section class="detail-section"><h3>Checklist <span class="muted">' + task.steps.filter(function (s) { return s.done; }).length + '/' + task.steps.length + '</span></h3><div class="progress"><i style="width:' + getProgress(task) + '%"></i></div><div class="detail-step-list">' + (task.steps.length ? task.steps.map(function (s) { return '<div class="detail-step-row"><label class="detail-step"><input type="checkbox" data-detail-step="' + s.id + '" ' + (s.done ? "checked" : "") + '><span class="' + (s.done ? "step-done" : "") + '">' + escapeHtml(s.text) + '</span></label><button type="button" class="text-button" data-edit-step="' + s.id + '">Edit</button></div>'; }).join("") : '<p class="muted">No steps yet.</p>') + '</div><form class="add-step-form" id="detail-step-form"><input name="step" placeholder="Add a step" required><button class="btn" type="submit">Add</button></form><div class="ai-box"><div><strong>Need a starting point?</strong><p>Choose any suggestions you want to add.</p></div><button type="button" class="btn secondary" id="detail-suggest-steps">Suggest steps with AI</button><div id="detail-suggestions" class="ai-suggestions" hidden></div></div></section>' +
    '<section class="detail-section"><h3>Notes and evidence</h3><form class="detail-note-form" id="detail-note-form"><textarea name="note" placeholder="Write a note..." aria-label="Write a note" required></textarea><div class="note-controls"><label class="btn secondary" for="note-images">Choose images</label><input id="note-images" name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden><button class="btn primary" type="submit">Add note</button></div><p class="upload-error" id="note-upload-error" role="alert" hidden></p><div class="attachment-previews" id="note-image-previews"></div><p class="upload-status" id="note-upload-status" role="status" aria-live="polite"></p><small class="muted">JPEG, PNG, or WebP. Up to 5 images, 5 MB each.</small></form><div class="timeline">' + noteHtml + '</div></section>' +
    '<section class="detail-section"><details class="history"><summary>History</summary><div class="history-list">' + historyHtml + '</div></details></section>';
  renderPendingNotePreviews();
  if (detailSuggestions.length) renderAISuggestions(document.getElementById("detail-suggestions"), detailSuggestions, "detail");
}
async function toggleStep(taskId, stepId, checked) {
  try { await api.updateStep(taskId, stepId, { done: checked }); await refreshTasks(); }
  catch (error) { reportError(error); await refreshTasks().catch(function () {}); }
}

async function saveTaskForm(event) {
  event.preventDefault();
  const title = taskForm.elements.title.value.trim(); const titleError = document.getElementById("title-error");
  if (!title) { titleError.hidden = false; taskForm.elements.title.focus(); return; }
  titleError.hidden = true;
  const steps = Array.from(document.querySelectorAll("#step-inputs .step-input-row")).map(function (row) { return { text: row.querySelector("input").value.trim(), source: row.dataset.source || "user" }; }).filter(function (s) { return s.text; });
  const body = { title: title, description: taskForm.elements.description.value.trim(), priority: taskForm.elements.priority.value, dueDate: taskForm.elements.dueDate.value || null, projectId: taskForm.elements.projectId.value ? Number(taskForm.elements.projectId.value) : null };
  const submit = taskForm.querySelector('[type="submit"]'); const previous = submit.textContent; submit.disabled = true; submit.textContent = "Saving…";
  try {
    if (editingId == null) {
      body.steps = steps.map(function (s, index) { return { text: s.text, source: s.source, position: index }; });
      await api.createTask(body); showToast("Task created");
    } else {
      const id = editingId; await api.updateTask(id, body);
      const existing = findTask(id).steps;
      for (let i = 0; i < steps.length; i++) {
        const old = existing.find(function (s) { return s.text === steps[i].text; });
        if (old) await api.updateStep(id, old.id, { position: i });
        else await api.createStep(id, { text: steps[i].text, source: steps[i].source, position: i });
      }
      for (const oldStep of existing) if (!steps.some(function (s) { return s.text === oldStep.text; })) await api.deleteStep(id, oldStep.id);
      showToast("Task updated");
    }
    closeCreateForm(); await refreshTasks();
  } catch (error) { reportError(error); }
  finally { submit.disabled = false; submit.textContent = previous; }
}

function initializeAuthPage(form) {
  const errorEl = document.getElementById("auth-error"); const submit = form.querySelector('[type="submit"]');
  form.querySelectorAll("[data-password-toggle]").forEach(function (button) {
    button.addEventListener("click", function () {
      const input = document.getElementById(button.dataset.passwordToggle);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.textContent = show ? "Hide" : "Show";
      button.setAttribute("aria-label", show ? "Hide password" : "Show password");
      button.setAttribute("aria-pressed", String(show));
    });
  });
  api.me().then(function () { window.location.replace("/"); }).catch(function (error) { if (error.status !== 401) { errorEl.textContent = error.message; errorEl.hidden = false; } });
  form.addEventListener("submit", async function (event) {
    event.preventDefault(); errorEl.hidden = true; submit.disabled = true;
    const original = submit.textContent; submit.textContent = form.dataset.authMode === "register" ? "Creating account…" : "Logging in…";
    try {
      const body = { email: form.elements.email.value.trim(), password: form.elements.password.value };
      if (form.dataset.authMode === "register") body.name = form.elements.name.value.trim();
      await api[form.dataset.authMode](body); window.location.replace("/");
    } catch (error) { errorEl.textContent = error.message; errorEl.hidden = false; }
    finally { submit.disabled = false; submit.textContent = original; }
  });
}

function showBoardError(error) {
  const box = document.getElementById("app-loading");
  const message = error && error.status === 404 ? "This page could not be found." : (error.message || "Could not load Tasklog.");
  box.innerHTML = '<section class="load-error"><h1>We could not open your workspace</h1><p>' + escapeHtml(message) + '</p><div><button class="btn primary" id="retry-load">Try again</button><a class="btn" href="login.html">Back to log in</a></div></section>';
  box.querySelector("#retry-load").addEventListener("click", initializeBoardPage);
}
// Shows a small placeholder while the login and task requests are loading.
function showBoardLoading() {
  const loading = document.getElementById("app-loading");
  loading.innerHTML = '<div class="loading-skeleton loading-skeleton-title"></div><div class="loading-skeleton-grid"><i class="loading-skeleton"></i><i class="loading-skeleton"></i><i class="loading-skeleton"></i></div><span>Checking your session and loading tasks…</span>';
}
async function initializeBoardPage() {
  const loading = document.getElementById("app-loading"); const shell = document.getElementById("app-shell");
  loading.hidden = false; showBoardLoading(); shell.hidden = true;
  try {
    const result = await api.me();
    currentUser = result.user;
    renderUserIdentity();
    await loadMySettings();
    await refreshTasks();
    await restoreNavigationFromHash();
    loading.hidden = true; shell.hidden = false;
  } catch (error) {
    if (error.status === 401) { window.location.replace("login.html"); return; }
    showBoardError(error);
  }
}

applyThemePreference();

const authForm = document.getElementById("auth-form");
if (authForm) {
  initializeAuthPage(authForm);
} else if (document.getElementById("app-shell")) {
  // Signs out through the existing session endpoint and returns to the login page.
  async function logOut(event) {
    event.preventDefault();
    try { await api.logout(); window.location.replace("login.html"); }
    catch (error) { reportError(error); }
  }
  document.getElementById("logout-link").addEventListener("click", logOut);
  document.getElementById("sidebar-logout-link").addEventListener("click", logOut);
  document.getElementById("user-menu-toggle").addEventListener("click", toggleUserMenu);
  document.getElementById("user-menu").addEventListener("click", function (event) {
    if (event.target.closest("[data-view]")) closeUserMenu(true);
    else if (event.target.closest("#logout-link")) closeUserMenu(false);
  });
  document.addEventListener("click", closeUserMenuOnOutsideClick);
  document.getElementById("create-task").addEventListener("click", openCreateForm);
  document.getElementById("notification-toggle").addEventListener("click", toggleNotificationMenu);
  document.getElementById("notifications-refresh").addEventListener("click", loadNotifications);
  document.getElementById("notification-list").addEventListener("click", openNotificationTask);
  document.addEventListener("click", closeNotificationsOnOutsideClick);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      const menu = document.getElementById("user-menu");
      const wasOpen = menu && !menu.hidden;
      closeNotificationMenu();
      closeUserMenu(wasOpen);
    }
  });
  window.addEventListener("focus", loadNotifications);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) loadNotifications(); });
  document.getElementById("profile-form").addEventListener("submit", saveProfileName);
  document.getElementById("password-form").addEventListener("submit", saveNewPassword);
  document.getElementById("delete-account-form").addEventListener("submit", deleteMyAccountFromProfile);
  document.getElementById("settings-form").addEventListener("submit", saveTaskSettings);
  document.getElementById("dark-mode-toggle").addEventListener("change", handleThemeToggle);
  document.getElementById("system-theme").addEventListener("click", function () { saveThemeMode("system"); });
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").addEventListener) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      if (getThemeMode() === "system") applyThemePreference();
    });
  }
  document.getElementById("new-project").addEventListener("click", function () { openProjectForm(null); });
  document.getElementById("new-project-link").addEventListener("click", function () { openProjectForm(null); });
  projectForm.addEventListener("submit", saveProjectForm);
  document.querySelectorAll("[data-close-project]").forEach(function (button) { button.addEventListener("click", closeProjectForm); });
  projectOverlay.addEventListener("click", function (event) { if (event.target === projectOverlay) closeProjectForm(); });
  document.getElementById("project-color-options").addEventListener("click", function (event) {
    const choice = event.target.closest("[data-project-color]");
    if (!choice) return;
    renderProjectColorOptions(choice.dataset.projectColor);
  });
  document.getElementById("project-list").addEventListener("click", async function (event) {
    const selectButton = event.target.closest("[data-project-select]");
    if (selectButton) {
      await navigateToProject(selectButton.dataset.projectSelect, true);
      return;
    }
    const menuButton = event.target.closest("[data-project-menu]");
    if (menuButton) {
      const menu = document.querySelector('[data-project-dropdown="' + CSS.escape(menuButton.dataset.projectMenu) + '"]');
      const shouldOpen = menu.hidden;
      document.querySelectorAll(".project-menu").forEach(function (item) { item.hidden = true; });
      menu.hidden = !shouldOpen;
      event.stopPropagation();
      return;
    }
    const actionButton = event.target.closest("[data-project-action]");
    if (!actionButton) return;
    const project = projects.find(function (item) { return String(item.id) === actionButton.dataset.id; });
    document.querySelectorAll(".project-menu").forEach(function (item) { item.hidden = true; });
    if (!project) return;
    if (actionButton.dataset.projectAction === "rename") {
      openProjectForm(project);
      return;
    }
    const warning = "Delete “" + project.name + "”? This permanently deletes " + project.taskCount + " task" + (project.taskCount === 1 ? "" : "s") + " and their steps, notes, history, and attachments. This cannot be undone.";
    if (!window.confirm(warning)) return;
    try {
      const projectTaskIds = tasks.filter(function (task) { return String(task.projectId) === String(project.id); }).map(function (task) { return task.id; });
      const result = await api.deleteProject(project.id);
      if (projectTaskIds.some(function (id) { return String(id) === String(activeTaskId); })) closeDetails();
      if (String(activeProjectId) === String(project.id)) {
        activeProjectId = null;
        currentView = "board";
        window.history.replaceState(null, "", "#board");
      }
      await refreshTasks();
      showToast("Project deleted; " + result.tasksDeleted + " task" + (result.tasksDeleted === 1 ? "" : "s") + " removed");
    } catch (error) { reportError(error); }
  });
  document.querySelectorAll("[data-create-status]").forEach(function (button) { button.addEventListener("click", openCreateForm); });
  taskForm.addEventListener("submit", saveTaskForm);
  document.querySelectorAll("[data-close-create]").forEach(function (button) { button.addEventListener("click", closeCreateForm); });
  createOverlay.addEventListener("click", function (event) { if (event.target === createOverlay) closeCreateForm(); });
  document.getElementById("add-step").addEventListener("click", function () { addStepInput("", "user"); });
  document.getElementById("step-inputs").addEventListener("click", function (event) { if (event.target.classList.contains("step-remove")) event.target.closest(".step-input-row").remove(); });
  document.getElementById("step-inputs").addEventListener("keydown", function (event) { if (event.key === "Enter" && event.target.tagName === "INPUT") { event.preventDefault(); addStepInput("", "user"); } });
  document.getElementById("suggest-steps").addEventListener("click", function () { requestAISuggestions("create"); });
  document.getElementById("suggestions").addEventListener("click", async function (event) {
    const retry = event.target.closest("[data-ai-retry='create']");
    if (retry) return requestAISuggestions("create");
    const add = event.target.closest("[data-ai-add='create']");
    if (add) return addAISuggestions("create", [Number(add.dataset.aiIndex)]);
    const addAll = event.target.closest("[data-ai-add-all='create']");
    if (addAll) return addAISuggestions("create", createSuggestions.map(function (_, index) { return index; }));
    const dismiss = event.target.closest("[data-ai-dismiss='create']");
    if (dismiss) { createSuggestions.splice(Number(dismiss.dataset.aiIndex), 1); return renderAISuggestions(event.currentTarget, createSuggestions, "create"); }
    if (event.target.closest("[data-ai-dismiss-all='create']")) { createSuggestions = []; event.currentTarget.hidden = true; }
  });
  document.querySelectorAll("[data-view]").forEach(function (link) { link.addEventListener("click", function (event) {
    event.preventDefault();
    if (link.dataset.view === "dashboard") navigateToDashboard(true);
    else if (link.dataset.view === "reports") navigateToReports(true);
    else if (link.dataset.view === "calendar") navigateToCalendar(true);
    else if (link.dataset.view === "profile" || link.dataset.view === "settings") navigateToAccountPage(link.dataset.view, true);
    else navigateToProject(null, true);
  }); });
  document.getElementById("calendar-previous").addEventListener("click", function () { changeCalendarMonth(-1); });
  document.getElementById("calendar-next").addEventListener("click", function () { changeCalendarMonth(1); });
  document.getElementById("calendar-today").addEventListener("click", function () {
    const today = new Date();
    calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    loadCalendarTasks();
  });
  document.getElementById("calendar-view").addEventListener("click", function (event) {
    const chip = event.target.closest("[data-calendar-task]");
    if (chip) { openDetails(chip.dataset.calendarTask); return; }
    if (event.target.closest(".calendar-more")) return;
    const createButton = event.target.closest("[data-calendar-create]");
    if (createButton) { openCreateForm(createButton.dataset.calendarCreate); return; }
    const day = event.target.closest("[data-calendar-date]");
    if (day) openCreateForm(day.dataset.calendarDate);
  });
  document.getElementById("calendar-view").addEventListener("dragstart", function (event) {
    const chip = event.target.closest("[data-calendar-task]");
    if (!chip) return;
    event.dataTransfer.setData("text/plain", chip.dataset.calendarTask);
    event.dataTransfer.effectAllowed = "move";
    chip.classList.add("is-dragging");
  });
  document.getElementById("calendar-view").addEventListener("dragend", function (event) {
    const chip = event.target.closest("[data-calendar-task]");
    if (chip) chip.classList.remove("is-dragging");
    document.querySelectorAll(".calendar-day.drag-target,.agenda-day.drag-target").forEach(function (day) { day.classList.remove("drag-target"); });
  });
  document.getElementById("calendar-view").addEventListener("dragover", function (event) {
    const day = event.target.closest("[data-calendar-date]");
    if (!day) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    day.classList.add("drag-target");
  });
  document.getElementById("calendar-view").addEventListener("dragleave", function (event) {
    const day = event.target.closest("[data-calendar-date]");
    if (day && !day.contains(event.relatedTarget)) day.classList.remove("drag-target");
  });
  document.getElementById("calendar-view").addEventListener("drop", function (event) {
    const day = event.target.closest("[data-calendar-date]");
    if (!day) return;
    event.preventDefault();
    day.classList.remove("drag-target");
    moveCalendarTask(event.dataTransfer.getData("text/plain"), day.dataset.calendarDate);
  });
  document.getElementById("report-days").addEventListener("change", function () {
    loadReportActivity();
    loadReportProof();
  });
  document.getElementById("print-report").addEventListener("click", function () { window.print(); });
  document.querySelector(".inbox-select").addEventListener("click", function () { navigateToProject("inbox", true); });
  document.getElementById("sidebar-toggle").addEventListener("click", function () {
    const isOpen = document.getElementById("sidebar-toggle").getAttribute("aria-expanded") === "true";
    setSidebarDrawerOpen(!isOpen);
  });
  document.getElementById("sidebar-backdrop").addEventListener("click", closeSidebarDrawer);
  window.addEventListener("hashchange", restoreNavigationFromHash);
  document.getElementById("due-soon-list").addEventListener("click", function (event) { const b = event.target.closest("[data-dashboard-task]"); if (b) openDetails(b.dataset.dashboardTask); });
  document.getElementById("search").addEventListener("input", function () { renderBoard(); if (currentView === "calendar") loadCalendarTasks(); });
  document.getElementById("filter-status").addEventListener("change", function () { renderBoard(); if (currentView === "calendar") loadCalendarTasks(); });
  document.getElementById("filter-priority").addEventListener("change", function () { renderBoard(); if (currentView === "calendar") loadCalendarTasks(); });
  board.addEventListener("click", async function (event) {
    if (event.target.closest("[data-empty-create]")) { openCreateForm(); return; }
    const trigger = event.target.closest("[data-menu]");
    if (trigger) {
      const menu = document.querySelector('[data-dropdown="' + CSS.escape(trigger.dataset.menu) + '"]');
      const open = menu.hidden; document.querySelectorAll(".dropdown").forEach(function (d) { d.hidden = true; }); menu.hidden = !open; event.stopPropagation(); return;
    }
    const button = event.target.closest("[data-action]");
    if (button) {
      const id = button.dataset.id; const task = findTask(id); const action = button.dataset.action;
      document.querySelectorAll(".dropdown").forEach(function (d) { d.hidden = true; }); if (!task) return;
      if (action === "open") return openDetails(id);
      if (action === "edit") return openEditForm(id);
      if (action === "delete" && !window.confirm("Delete this task? This cannot be undone.")) return;
      try {
        if (action === "delete") { await api.deleteTask(id); if (String(activeTaskId) === String(id)) closeDetails(); showToast("Task deleted"); }
        if (action === "start") { await api.updateTask(id, { status: "in_progress" }); showToast("Task started"); }
        if (action === "todo") { await api.updateTask(id, { status: "pending" }); showToast("Moved to To do"); }
        if (action === "reopen") { await api.updateTask(id, { status: "in_progress" }); showToast("Task reopened"); }
        if (action === "done") {
          await api.updateTask(id, { status: "completed" });
          for (const step of task.steps) if (!step.done) await api.updateStep(id, step.id, { done: true });
          showToast("Task completed");
        }
        await refreshTasks();
      } catch (error) { reportError(error); await refreshTasks().catch(function () {}); }
      return;
    }
    if (event.target.closest("input[type=checkbox], .card-step")) return;
    const card = event.target.closest(".card"); if (card) openDetails(card.dataset.cardId);
  });
  board.addEventListener("keydown", function (event) { const card = event.target.closest(".card"); if (card && event.target === card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openDetails(card.dataset.cardId); } });
  board.addEventListener("change", function (event) { const box = event.target.closest("[data-step-task]"); if (box) toggleStep(box.dataset.stepTask, box.dataset.step, box.checked); });
  detailsPanel.addEventListener("change", async function (event) {
    const box = event.target.closest("[data-detail-step]");
    if (box) toggleStep(activeTaskId, box.dataset.detailStep, box.checked);
    if (event.target.id === "note-images") {
      const files = Array.from(event.target.files || []);
      const selectionId = ++noteFileSelectionId;
      const error = document.getElementById("note-upload-error");
      const tooLarge = files.find(function (file) { return file.size > 5 * 1024 * 1024; });
      const status = document.getElementById("note-upload-status");
      event.target.value = "";
      pendingNoteFiles = [];
      renderPendingNotePreviews();
      let unsupported = null;
      if (files.length <= 5 && !tooLarge) {
        status.textContent = "Checking image files…";
        for (const file of files) {
          if (!(await isSupportedNoteImage(file))) { unsupported = file; break; }
        }
      }
      if (selectionId !== noteFileSelectionId) return;
      if (files.length > 5) error.textContent = "Choose no more than 5 images.";
      else if (tooLarge) error.textContent = tooLarge.name + " is larger than 5 MB.";
      else if (unsupported) error.textContent = unsupported.name + " is not a valid JPEG, PNG, or WebP image.";
      else error.textContent = "";
      status.textContent = "";
      const valid = files.length <= 5 && !tooLarge && !unsupported;
      error.hidden = valid;
      pendingNoteFiles = valid ? files : [];
      renderPendingNotePreviews();
    }
  });
  detailsPanel.addEventListener("click", function (event) {
    const suggest = event.target.closest("#detail-suggest-steps");
    if (suggest) { requestAISuggestions("detail"); return; }
    const retry = event.target.closest("[data-ai-retry='detail']");
    if (retry) { requestAISuggestions("detail"); return; }
    const addSuggestion = event.target.closest("[data-ai-add='detail']");
    if (addSuggestion) { addAISuggestions("detail", [Number(addSuggestion.dataset.aiIndex)]); return; }
    const addAllSuggestions = event.target.closest("[data-ai-add-all='detail']");
    if (addAllSuggestions) { addAISuggestions("detail", detailSuggestions.map(function (_, index) { return index; })); return; }
    const dismissSuggestion = event.target.closest("[data-ai-dismiss='detail']");
    if (dismissSuggestion) { detailSuggestions.splice(Number(dismissSuggestion.dataset.aiIndex), 1); renderAISuggestions(document.getElementById("detail-suggestions"), detailSuggestions, "detail"); return; }
    if (event.target.closest("[data-ai-dismiss-all='detail']")) { detailSuggestions = []; document.getElementById("detail-suggestions").hidden = true; return; }
    const editStep = event.target.closest("[data-edit-step]");
    if (editStep) {
      const task = findTask(activeTaskId);
      const step = task && task.steps.find(function (item) { return String(item.id) === editStep.dataset.editStep; });
      if (!step) return;
      const row = editStep.closest(".detail-step-row");
      row.innerHTML = '<form class="edit-step-form" data-edit-step-form="' + step.id + '"><input name="text" value="' + escapeHtml(step.text) + '" maxlength="500" required><button class="btn" type="submit">Save</button><button class="btn" type="button" data-cancel-step-edit>Cancel</button></form>';
      row.querySelector("input").focus();
      return;
    }
    if (event.target.closest("[data-cancel-step-edit]")) { renderDetails(); return; }
    const edit = event.target.closest("[data-detail-edit]");
    if (edit) { openEditForm(edit.dataset.detailEdit); return; }
    const removePreview = event.target.closest("[data-remove-note-file]");
    if (removePreview) {
      pendingNoteFiles.splice(Number(removePreview.dataset.removeNoteFile), 1);
      const error = document.getElementById("note-upload-error");
      if (error) { error.textContent = ""; error.hidden = true; }
      renderPendingNotePreviews();
      return;
    }
    const image = event.target.closest("[data-image]");
    if (image) {
      const viewer = document.getElementById("image-viewer");
      viewer.querySelector("img").src = image.dataset.image;
      viewer.hidden = false;
    }
  });
  detailsPanel.addEventListener("submit", async function (event) {
    const editStepForm = event.target.closest("[data-edit-step-form]");
    if (editStepForm) {
      event.preventDefault();
      try { await api.updateStep(activeTaskId, editStepForm.dataset.editStepForm, { text: editStepForm.elements.text.value.trim() }); await refreshTasks(); }
      catch (error) { reportError(error); }
      return;
    }
    if (event.target.id === "detail-step-form") {
      event.preventDefault(); const text = event.target.elements.step.value.trim(); if (!text) return;
      try { await api.createStep(activeTaskId, { text: text, source: "user" }); await refreshTasks(); }
      catch (error) { reportError(error); }
    }
    if (event.target.id === "detail-note-form") {
      event.preventDefault();
      const form = event.target;
      const text = form.elements.note.value.trim();
      const files = pendingNoteFiles.slice();
      const submit = form.querySelector('[type="submit"]');
      const imagePicker = form.elements.images;
      const status = document.getElementById("note-upload-status");
      const errorBox = document.getElementById("note-upload-error");
      if (!text && pendingAttachmentNoteId == null) return;
      submit.disabled = true;
      imagePicker.disabled = true;
      submit.textContent = "Saving note…";
      status.textContent = "Saving note…";
      errorBox.hidden = true;
      try {
        if (pendingAttachmentNoteId == null) {
          const result = await api.createNote(activeTaskId, { text: text });
          pendingAttachmentNoteId = files.length ? result.note.id : null;
          if (files.length) form.elements.note.disabled = true;
        }
        if (files.length) {
          submit.textContent = "Uploading images…";
          status.textContent = "Uploading images…";
          await api.uploadAttachments(activeTaskId, pendingAttachmentNoteId, files);
        }
        form.elements.note.disabled = false;
        form.elements.note.value = "";
        clearPendingNoteImages();
        await refreshTasks();
        showToast(files.length ? "Note and images saved" : "Note added");
      } catch (error) {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
        status.textContent = pendingAttachmentNoteId == null ? "" : "Your note is saved. Submit again to retry the image upload.";
      } finally {
        submit.disabled = false;
        imagePicker.disabled = false;
        submit.textContent = pendingAttachmentNoteId == null ? "Add note" : "Retry upload";
      }
    }
  });
  document.getElementById("close-details").addEventListener("click", closeDetails);
  document.getElementById("panel-backdrop").addEventListener("click", closeDetails);
  document.addEventListener("click", function (event) {
    if (!event.target.closest(".menu-wrap")) document.querySelectorAll(".dropdown").forEach(function (d) { d.hidden = true; });
    if (!event.target.closest(".project-menu-wrap")) document.querySelectorAll(".project-menu").forEach(function (menu) { menu.hidden = true; });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    const viewer = document.getElementById("image-viewer");
    if (!viewer.hidden) { viewer.hidden = true; return; }
    document.querySelectorAll(".dropdown").forEach(function (d) { d.hidden = true; });
    document.querySelectorAll(".project-menu").forEach(function (menu) { menu.hidden = true; });
    closeSidebarDrawer();
    if (!projectOverlay.hidden) closeProjectForm();
    if (!createOverlay.hidden) closeCreateForm();
    if (activeTaskId != null) closeDetails();
  });
  document.getElementById("image-viewer").addEventListener("click", function (event) {
    if (event.target === this || event.target.closest("button")) this.hidden = true;
  });
  board.addEventListener("dragstart", function (event) { const card = event.target.closest(".card"); if (!card) return; event.dataTransfer.setData("text/plain", card.dataset.cardId); event.dataTransfer.effectAllowed = "move"; });
  board.querySelectorAll(".column").forEach(function (column) {
    column.addEventListener("dragover", function (event) { event.preventDefault(); column.classList.add("drop-target"); });
    column.addEventListener("dragleave", function (event) { if (!column.contains(event.relatedTarget)) column.classList.remove("drop-target"); });
    column.addEventListener("drop", async function (event) {
      event.preventDefault(); column.classList.remove("drop-target"); const id = event.dataTransfer.getData("text/plain"); const task = findTask(id); const status = column.dataset.status;
      if (!task || task.status === status || status === "completed") return;
      try { await api.updateTask(id, { status: status }); await refreshTasks(); showToast("Task moved to " + statusLabels[status]); }
      catch (error) { reportError(error); }
    });
  });
  initializeBoardPage();
}
