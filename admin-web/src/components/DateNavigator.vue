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
    <div class="button-row" aria-label="日期快捷切换">
      <el-button @click="move(-1)">前一天</el-button>
      <el-button @click="emit('select', today)">今天</el-button>
      <el-button @click="move(1)">后一天</el-button>
    </div>
    <slot />
  </div>
  <div ref="strip" class="schedule-date-strip" aria-label="本周日期">
    <button v-for="day in days" :key="day.date" type="button" class="schedule-date-button"
      :class="{ 'is-selected': day.selected, 'is-today': day.today }" :aria-pressed="day.selected"
      :aria-label="day.date + ' ' + day.weekday + (day.today ? ' 今天' : '')" @click="emit('select', day.date)">
      <span>{{ day.weekday }}</span><strong>{{ day.label }}</strong><small>{{ day.today ? '今天' : '\u00a0' }}</small>
    </button>
  </div>
</template>
