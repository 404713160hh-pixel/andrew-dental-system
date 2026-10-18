/* Permission-scoped appointment calendar. All appointment details stay in app.js. */
(function (global) {
  'use strict';

  const ZONE = 'Asia/Shanghai';
  const DAY_MS = 86400000;
  const MIN_DISPLAY_MINUTES = 28;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const statusLabels = { booked: '已预约', attended: '已到诊', no_show: '未出席' };
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  let view = 'week';
  let anchor = '';
  let serverDay = '';
  let onChange = null;

  const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  function validDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }

  function localParts(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = Object.fromEntries(formatter.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    return { day: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
  }

  function addDays(date, amount) {
    return new Date(Date.parse(date + 'T00:00:00Z') + amount * DAY_MS).toISOString().slice(0, 10);
  }

  function weekStart(date) {
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    return addDays(date, -(weekday + 6) % 7);
  }

  function datesForView() {
    const first = view === 'day' ? anchor : weekStart(anchor);
    return Array.from({ length: view === 'day' ? 1 : 7 }, (_, index) => addDays(first, index));
  }

  function minuteLabel(minute) {
    const value = Math.max(0, Math.min(1440, Math.floor(minute)));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function dayTitle(date) {
    const [year, month, day] = date.split('-').map(Number);
    return `${year}年${month}月${day}日`;
  }

  function rangeTitle(dates) {
    if (dates.length === 1) return dayTitle(dates[0]);
    const first = dates[0];
    const last = dates[dates.length - 1];
    return dayTitle(first) + ' — ' + (first.slice(0, 7) === last.slice(0, 7) ? `${Number(last.slice(8))}日` : dayTitle(last));
  }

  function midnight(date) {
    return Date.parse(date + 'T00:00:00+08:00');
  }

  function splitAppointments(appointments, dates) {
    const byDate = new Map(dates.map(date => [date, []]));
    let cancelled = 0;
    let invalid = 0;
    for (const appointment of appointments) {
      const start = Date.parse(appointment.start);
      const end = Date.parse(appointment.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        invalid += 1;
        continue;
      }
      const matches = dates.filter(date => start < midnight(date) + DAY_MS && end > midnight(date));
      if (appointment.status === 'cancelled') {
        if (matches.length) cancelled += 1;
        continue;
      }
      for (const date of matches) {
        const dayStart = midnight(date);
        byDate.get(date).push({
          appointment, date,
          start: (Math.max(start, dayStart) - dayStart) / 60000,
          end: (Math.min(end, dayStart + DAY_MS) - dayStart) / 60000,
          fromPrevious: start < dayStart,
          toNext: end > dayStart + DAY_MS,
        });
      }
    }
    return { byDate, cancelled, invalid };
  }

  // Interval groups have independent lane counts. Touching appointments can share a lane.
  // The visual minimum also participates in collision detection so short visits remain usable.
  function layoutSegments(segments, rangeEnd) {
    const sorted = segments.map(segment => ({
      ...segment, collisionEnd: Math.min(rangeEnd, Math.max(segment.end, segment.start + MIN_DISPLAY_MINUTES)),
    })).sort((a, b) => a.start - b.start || b.end - a.end || String(a.appointment.id).localeCompare(String(b.appointment.id)));
    const groups = [];
    let group = [];
    let groupEnd = -1;
    for (const segment of sorted) {
      if (group.length && segment.start >= groupEnd) {
        groups.push(group);
        group = [];
        groupEnd = -1;
      }
      group.push(segment);
      groupEnd = Math.max(groupEnd, segment.collisionEnd);
    }
    if (group.length) groups.push(group);
    return groups.flatMap(connected => {
      const occupiedUntil = [];
      for (const segment of connected) {
        let lane = occupiedUntil.findIndex(end => end <= segment.start);
        if (lane < 0) lane = occupiedUntil.length;
        occupiedUntil[lane] = segment.collisionEnd;
        segment.lane = lane;
      }
      return connected.map(segment => ({ ...segment, lanes: occupiedUntil.length }));
    });
  }

  function navigationButton(action, label, contents, extra = '') {
    return `<button type="button" class="cal-nav-button" data-cal-action="${action}" aria-label="${label}" ${extra}>${contents}</button>`;
  }

  function toolbar(dates, count) {
    const dateNavigation = view === 'list' ? '' : `<div class="cal-date-navigation">${navigationButton('today', '查看今天的预约', '今天')}<div class="cal-arrows">${navigationButton('prev', view === 'day' ? '查看前一天' : '查看上一周', '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg>')}${navigationButton('next', view === 'day' ? '查看后一天' : '查看下一周', '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m10 6 6 6-6 6"/></svg>')}</div></div>`;
    return `<div class="cal-toolbar"><div class="cal-title-group"><h2>${view === 'list' ? '预约列表' : rangeTitle(dates)}</h2><p>${view === 'list' ? '按筛选条件查看预约记录' : `${view === 'day' ? '当天' : '本周'} ${count} 个接诊预约 · 上海时间`}</p></div><div class="cal-toolbar-actions">${dateNavigation}<div class="cal-view-switch" role="group" aria-label="预约视图">${[['day', '日'], ['week', '周'], ['list', '列表']].map(([mode, label]) => `<button type="button" data-cal-action="${mode}" class="${mode === view ? 'is-active' : ''}" aria-pressed="${mode === view}">${label}</button>`).join('')}</div></div></div>`;
  }

  function render(options = {}) {
    const escape = typeof options.escape === 'function' ? options.escape : htmlEscape;
    const current = localParts(options.now || new Date().toISOString());
    serverDay = current?.day || localParts(new Date().toISOString()).day;
    if (!anchor) anchor = validDay(options.initialDate) ? options.initialDate : serverDay;
    if (typeof options.onChange === 'function') onChange = options.onChange;
    const dates = datesForView();
    if (view === 'list') return `<div class="dental-calendar cal-list-mode">${toolbar(dates, 0)}</div>`;

    const appointments = Array.isArray(options.appointments) ? options.appointments : [];
    const { byDate, cancelled, invalid } = splitAppointments(appointments, dates);
    const segments = [...byDate.values()].flat();
    const count = new Set(segments.map(segment => segment.appointment.id)).size;
    // Expand outside the normal 08:00–20:00 window when authorized records need it.
    const firstHour = Math.min(8, ...segments.map(segment => Math.floor(segment.start / 60)));
    const lastHour = Math.max(20, ...segments.map(segment => Math.ceil(segment.end / 60)));
    const startMinute = firstHour * 60;
    const endMinute = lastHour * 60;
    const rangeMinutes = endMinute - startMinute;
    const people = new Map((options.patients || []).map(person => [person.id, person.name]));
    const dentists = new Map((options.dentists || []).map(person => [person.id, person.name]));
    const clinics = new Map((options.clinics || []).map(clinic => [clinic.id, clinic.name]));
    const dentistOrder = [...dentists.keys()].sort();
    const isCustomer = typeof options.customer === 'function' ? options.customer() : Boolean(options.customer);
    const patientName = appointment => {
      const result = typeof options.patientName === 'function' ? options.patientName(appointment.patientId, appointment) : people.get(appointment.patientId);
      return result || appointment.patientId || '患者资料不可用';
    };

    const dayHeader = dates.map(date => {
      const number = Number(date.slice(8));
      const weekday = weekdays[new Date(date + 'T00:00:00Z').getUTCDay()];
      const dailyCount = byDate.get(date).length;
      return `<button type="button" class="cal-day-heading ${date === serverDay ? 'is-today' : ''}" data-cal-action="date" data-cal-date="${date}" aria-label="查看${dayTitle(date)}${weekday}的预约"><span>${weekday}</span><strong>${number}</strong><small>${dailyCount ? dailyCount + ' 个预约' : '暂无预约'}</small></button>`;
    }).join('');

    const timeTicks = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => `<span class="cal-time-tick" style="top:${index / (lastHour - firstHour) * 100}%">${minuteLabel((firstHour + index) * 60)}</span>`).join('');
    const dayColumns = dates.map(date => {
      const laidOut = layoutSegments(byDate.get(date), endMinute);
      const events = laidOut.map(segment => {
        const appointment = segment.appointment;
        const patient = patientName(appointment);
        const dentist = dentists.get(appointment.dentistId) || appointment.dentistId || '未提供接诊牙医';
        const clinic = clinics.get(appointment.clinicId) || appointment.clinicId || '未提供诊所';
        const startTime = minuteLabel(segment.start);
        const endTime = minuteLabel(segment.end);
        const status = statusLabels[appointment.status] || appointment.status || '状态未提供';
        const primaryName = isCustomer ? clinic : patient;
        const top = (segment.start - startMinute) / rangeMinutes * 100;
        const height = (Math.min(endMinute, segment.collisionEnd) - segment.start) / rangeMinutes * 100;
        const laneWidth = 100 / segment.lanes;
        const tone = Math.max(0, dentistOrder.indexOf(appointment.dentistId)) % 4;
        const continued = segment.fromPrevious || segment.toNext ? `<span class="cal-continuation">${segment.fromPrevious ? '承接前一天' : ''}${segment.fromPrevious && segment.toNext ? ' · ' : ''}${segment.toNext ? '延续至次日' : ''}</span>` : '';
        const label = `${dayTitle(date)} ${startTime}至${endTime}，${patient}，${dentist}，${clinic}，${status}。查看预约详情`;
        return `<button type="button" class="cal-event cal-tone-${tone} ${segment.lanes > 1 ? 'cal-event-overlap' : ''} ${segment.end - segment.start < 45 ? 'cal-event-short' : ''}" data-action="appointment-detail" data-id="${escape(appointment.id)}" data-cal-event-date="${date}" data-cal-lane="${segment.lane}" data-cal-lanes="${segment.lanes}" style="top:${top.toFixed(4)}%;height:${height.toFixed(4)}%;left:calc(${(segment.lane * laneWidth).toFixed(4)}% + 4px);width:calc(${laneWidth.toFixed(4)}% - 8px)" aria-label="${escape(label)}" title="${escape(`${patient} · ${dentist}\n${startTime}–${endTime} · ${status}\n${appointment.problem || '未填写就诊问题'}`)}"><span class="cal-event-title"><strong>${escape(primaryName)}</strong><span class="cal-status-dot cal-status-${escape(appointment.status)}" aria-hidden="true"></span></span><span class="cal-event-time">${startTime}–${endTime}</span><span class="cal-event-dentist">${escape(dentist)}${view === 'day' && !isCustomer ? ' · ' + escape(clinic) : ''}</span><span class="cal-event-problem">${escape(appointment.problem || '未填写就诊问题')}</span>${continued}</button>`;
      }).join('');
      const nowLine = current && date === current.day && current.minute >= startMinute && current.minute < endMinute ? `<div class="cal-now-line" style="top:${((current.minute - startMinute) / rangeMinutes * 100).toFixed(4)}%" aria-label="当前服务时间${minuteLabel(current.minute)}"><span>${minuteLabel(current.minute)}</span></div>` : '';
      return `<div class="cal-day-column ${date === serverDay ? 'is-today' : ''}" data-cal-date="${date}">${events}${nowLine}</div>`;
    }).join('');

    const emptyState = !count ? `<div class="cal-empty-state"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16v16H4zM8 3v4M16 3v4M4 10h16M9 15h6"/></svg><strong>${view === 'day' ? '这一天' : '这一周'}暂无接诊预约</strong><span>可切换日期，或在列表中查看其他预约记录</span></div>` : '';
    const excludedNote = cancelled ? `当前范围另有 ${cancelled} 个已取消预约，可在列表中查看。` : '已取消预约不占用接诊日历，可在列表中查看。';
    const invalidNote = invalid ? ` ${invalid} 条时间不完整的记录未排入日历。` : '';
    return `<div class="dental-calendar cal-${view}-mode">${toolbar(dates, count)}<div class="cal-scroll-hint">左右滑动查看完整一周</div><div class="cal-scroll" tabindex="0" role="region" aria-label="${escape(rangeTitle(dates))}预约日历，可滚动查看" style="--cal-days:${dates.length};--cal-hours:${lastHour - firstHour}"><div class="cal-stage"><div class="cal-header-row"><div class="cal-time-zone">GMT+8</div>${dayHeader}</div><div class="cal-grid-body"><div class="cal-time-axis">${timeTicks}</div><div class="cal-columns">${dayColumns}</div>${emptyState}</div></div></div><div class="cal-footer"><div class="cal-legend" aria-label="预约状态说明"><span><i class="cal-status-dot cal-status-booked"></i>已预约</span><span><i class="cal-status-dot cal-status-attended"></i>已到诊</span><span><i class="cal-status-dot cal-status-no_show"></i>未出席</span></div><p>${escape(excludedNote + invalidNote)}</p></div></div>`;
  }

  function handleAction(action, date) {
    if (!anchor) return false;
    if (['day', 'week', 'list'].includes(action)) view = action;
    else if (action === 'today') anchor = serverDay;
    else if (action === 'prev' || action === 'next') anchor = addDays(anchor, (action === 'prev' ? -1 : 1) * (view === 'day' ? 1 : 7));
    else if (action === 'date' && validDay(date)) { anchor = date; view = 'day'; }
    else return false;
    if (onChange) onChange({ view, anchor, range: datesForView() });
    return true;
  }

  const api = {
    render,
    handleAction,
    setDate(date) { if (!validDay(date)) return false; anchor = date; return true; },
    getDate() { return anchor; },
    setView(mode) { if (!['day', 'week', 'list'].includes(mode)) return false; view = mode; return true; },
    reset() { view = 'week'; anchor = ''; serverDay = ''; onChange = null; },
    get view() { return view; },
  };
  global.DentalCalendar = api;

  if (typeof document !== 'undefined') document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-cal-action]');
    if (!button || !button.closest('.dental-calendar')) return;
    event.preventDefault();
    const action = button.dataset.calAction;
    if (!handleAction(action, button.dataset.calDate)) return;
    // The containing page can replace its HTML synchronously; keep keyboard navigation useful.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
      const selector = action === 'date' ? '[data-cal-action="day"]' : `[data-cal-action="${action}"]`;
      document.querySelector('.dental-calendar ' + selector)?.focus({ preventScroll: true });
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
