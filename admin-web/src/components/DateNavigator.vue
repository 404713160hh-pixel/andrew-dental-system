<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { calendarWeek, moveCalendarDate } from '../schedule-view';
const props = defineProps<{ date: string; today: string }>();
const emit = defineEmits<{ select: [date: string] }>();
const strip = ref<HTMLDivElement | null>(null);
const days = computed(() => calendarWeek(props.date, props.today));
function move(offset: number) { emit('select', moveCalendarDate(props.date || props.today, offset)); }
async function revealSelectedDay() {
  await nextTick();
  const container = strip.value;
  const selected = container?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
  if (!container || !selected) return;
  const viewport = container.getBoundingClientRect();
  const item = selected.getBoundingClientRect();
  if (item.left >= viewport.left && item.right <= viewport.right) return;
  const centered = container.scrollLeft + item.left - viewport.left - (container.clientWidth - item.width) / 2;
  container.scrollTo({ left: Math.max(0, Math.min(container.scrollWidth - container.clientWidth, centered)), behavior: 'auto' });
}
onMounted(revealSelectedDay);
watch(() => [props.date, props.today], revealSelectedDay, { flush: 'post' });
</script>
<template>
  <div class="schedule-toolbar">
    <div class="date-nav-actions">
      <span class="date-nav-label">浏览日期</span>
      <div class="button-row" role="group" aria-label="日期快捷切换">
        <el-button aria-label="前一天" @click="move(-1)">前一天</el-button>
        <el-button aria-label="返回今天" @click="emit('select', today)">今天</el-button>
        <el-button aria-label="后一天" @click="move(1)">后一天</el-button>
      </div>
    </div>
    <div class="date-nav-mode"><slot /></div>
  </div>
  <div ref="strip" class="schedule-date-strip" role="group" aria-label="本周日期">
    <button v-for="day in days" :key="day.date" type="button" class="schedule-date-button"
      :class="{ 'is-selected': day.selected, 'is-today': day.today }" :aria-pressed="day.selected"
      :aria-label="day.date + ' ' + day.weekday + (day.today ? ' 今天' : '')" @click="emit('select', day.date)">
      <span>{{ day.weekday }}</span><strong>{{ day.label }}</strong><small>{{ day.today ? '今天' : '\u00a0' }}</small>
    </button>
  </div>
</template>

<style scoped>
.schedule-toolbar {
  align-items: flex-end;
  padding: 20px 24px 14px;
  gap: 18px;
}
.date-nav-actions { display: flex; flex-direction: column; gap: 8px; }
.date-nav-label {
  color: #686d70;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .04em;
}
.date-nav-actions .button-row { gap: 6px; }
.date-nav-actions :deep(.el-button) {
  min-height: 36px;
  padding-inline: 13px;
  border-color: #e7e4df;
  border-radius: 7px;
  color: #555b5f;
  font-size: 12px;
}
.date-nav-actions :deep(.el-button:hover) {
  border-color: #c9b99e;
  background: #f5f0e8;
  color: #292d30;
}
.date-nav-mode { display: flex; align-items: center; }
.date-nav-mode :deep(.el-button-group .el-button) {
  min-height: 36px;
  padding-inline: 16px;
  font-size: 12px;
}
.schedule-date-strip {
  grid-template-columns: repeat(7, minmax(64px, 1fr));
  gap: 8px;
  padding: 0 24px 20px;
  scrollbar-width: thin;
  scrollbar-color: #cfc4b3 transparent;
}
.schedule-date-button {
  min-height: 84px;
  gap: 6px;
  padding: 11px 8px 9px;
  border-color: #ebe8e2;
  border-radius: 9px;
  background: #fff;
  color: #686d70;
  transition: background-color .16s ease, border-color .16s ease, color .16s ease;
}
.schedule-date-button strong { color: #292d30; font-size: 18px; font-weight: 650; }
.schedule-date-button small { min-height: 14px; color: #80653d; font-size: 10px; }
.schedule-date-button:hover {
  border-color: #c9b99e;
  background: #fcfbf9;
}
.schedule-date-button.is-today:not(.is-selected) {
  border-color: #b79a6b;
  background: #fcfbf9;
}
.schedule-date-button.is-selected {
  border-color: #292d30;
  background: #292d30;
  color: #fff;
  box-shadow: 0 4px 12px rgb(41 45 48 / 12%);
}
.schedule-date-button.is-selected strong { color: #fff; }
.schedule-date-button.is-selected small { color: #e0cba7; }
.schedule-date-button:focus-visible,
.date-nav-actions :deep(.el-button:focus-visible),
.date-nav-mode :deep(.el-button:focus-visible) {
  outline: 3px solid #80653d;
  outline-offset: 2px;
}
@media (max-width: 720px) {
  .schedule-toolbar { align-items: stretch; padding: 16px 16px 12px; gap: 13px; }
  .date-nav-actions { flex: 1; min-width: 0; }
  .date-nav-actions .button-row { flex-wrap: nowrap; }
  .date-nav-actions :deep(.el-button) { flex: 1 1 0; padding-inline: 7px; }
  .date-nav-mode { justify-content: flex-end; }
  .schedule-date-strip { grid-template-columns: repeat(7, minmax(54px, 1fr)); gap: 6px; padding: 0 16px 16px; }
  .schedule-date-button { min-height: 76px; padding: 10px 5px 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .schedule-date-button { transition: none; }
}
</style>
