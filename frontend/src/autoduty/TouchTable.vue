<template>
  <div class="tt" :style="{ '--tt-row-h': rowHeight + 'px' }">
    <!-- 表头固定（横向同步滚动，纵向不跟随） -->
    <div class="tt-head">
      <div
        v-for="(col, c) in columns"
        :key="'th' + c"
        class="tt-th"
        :class="{ 'tt-th-date': col.type === 'date' }"
      >
        <span class="tt-th-text">{{ col.label }}</span>
      </div>
    </div>

    <div class="tt-body">
      <div v-if="!rows.length" class="tt-empty">暂无数据，点击上方「添加行」新增</div>
      <div v-for="(row, r) in rows" :key="'tr' + r" class="tt-tr">
        <div
          v-for="(col, c) in columns"
          :key="'td' + c"
          class="tt-td"
          :class="{ 'tt-td-date': col.type === 'date' }"
        >
          <!-- 日期列：自由文本（兼容 9/26、2026-09-26 等既有格式）+ 日历按钮（原生选择器） -->
          <template v-if="col.type === 'date'">
            <input
              class="tt-input"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :value="String(row[c] ?? '')"
              :placeholder="col.placeholder || '如 9/26'"
              @input="onInput(r, c, $event.target.value)"
            />
            <button
              class="tt-cal"
              type="button"
              :aria-label="'选择' + col.label"
              @click.stop="openPicker(r, c)"
            >
              <span class="icon" aria-hidden="true">&#xE787;</span>
            </button>
            <input
              :ref="(el) => holdPicker(r, c, el)"
              class="tt-native-date"
              type="date"
              tabindex="-1"
              aria-hidden="true"
              @change="onDatePick(r, c, $event.target.value)"
            />
          </template>
          <input
            v-else
            class="tt-input"
            type="text"
            autocomplete="off"
            :value="String(row[c] ?? '')"
            :placeholder="col.placeholder || '点击输入'"
            @input="onInput(r, c, $event.target.value)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { defineModel } from 'vue';

const props = defineProps({
  // [{ label, type: 'text'|'date', placeholder? }]
  columns: { type: Array, required: true },
  // 行高（触屏推荐 ≥52px）
  rowHeight: { type: Number, default: 52 },
});

const rows = defineModel('rows', { type: Array, default: () => [] });

// 隐藏的原生 date 输入（供日历按钮弹出选择器），按 行_列 缓存真实 DOM
const pickers = {};
const keyOf = (r, c) => r + '_' + c;

function holdPicker(r, c, el) {
  const k = keyOf(r, c);
  if (el) pickers[k] = el;
  else delete pickers[k];
}

function setCell(r, c, v) {
  const next = rows.value[r] ? rows.value[r].slice() : [];
  next[c] = v;
  rows.value[r] = next;
}

function onInput(r, c, v) {
  setCell(r, c, v);
}

// 点日历按钮：调用 showPicker() 弹出系统日期选择；个别环境不支持时回退 click()
function openPicker(r, c) {
  const inp = pickers[keyOf(r, c)];
  if (!inp) return;
  try {
    if (typeof inp.showPicker === 'function') inp.showPicker();
    else inp.click();
  } catch (e) {
    inp.click();
  }
}

function onDatePick(r, c, v) {
  setCell(r, c, v);
  // 清空隐藏输入，允许下次选择同一日期仍触发 change
  const inp = pickers[keyOf(r, c)];
  if (inp) inp.value = '';
}
</script>

<style scoped>
/* 表格容器：独立滚动区域（触屏原生惯性滚动），表头 sticky 固定 */
.tt {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  touch-action: pan-x pan-y;
  overscroll-behavior: contain;
  background: #fff;
}

.tt-head {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  background: #f3f3f3;
  border-bottom: 1px solid #e0e0e0;
}

.tt-th {
  flex: 1 1 0;
  min-width: 96px;
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 12px;
  box-sizing: border-box;
}

.tt-th-date {
  flex: 0 0 224px;
}

.tt-th-text {
  font-size: 13px;
  font-weight: 600;
  color: #616161;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tt-body {
  position: relative;
}

.tt-tr {
  display: flex;
  min-height: var(--tt-row-h, 52px);
  border-bottom: 1px solid #f0f0f0;
}

.tt-tr:last-child {
  border-bottom: none;
}

.tt-td {
  flex: 1 1 0;
  min-width: 96px;
  box-sizing: border-box;
  border-right: 1px solid #f0f0f0;
}

.tt-td:last-child {
  border-right: none;
}

.tt-td-date {
  flex: 0 0 224px;
  position: relative;
}

/* 单元格输入：透明背景整格点击即可输入，聚焦高亮 */
.tt-input {
  width: 100%;
  height: 100%;
  min-height: var(--tt-row-h, 52px);
  border: none;
  background: transparent;
  padding: 0 12px;
  font: inherit;
  font-size: 15px;
  color: #1f1f1f;
  outline: none;
  box-sizing: border-box;
  border-radius: 0;
}

.tt-td-date .tt-input {
  padding-right: 44px;
}

.tt-input::placeholder {
  color: #b0b0b0;
}

.tt-input:focus {
  background: rgba(0, 103, 192, 0.06);
}

/* 日历按钮：44px 触摸目标，停靠日期格右侧 */
.tt-cal {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 44px;
  border: none;
  background: transparent;
  color: var(--accent-base, #0067c0);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.tt-cal:hover {
  background: rgba(0, 103, 192, 0.08);
}

/* 隐藏的原生日期输入：保留渲染（showPicker 需要非 display:none），离屏 + 透明 */
.tt-native-date {
  position: absolute;
  left: -9999px;
  top: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.tt-empty {
  padding: 28px 16px;
  color: #b0b0b0;
  font-size: 14px;
  text-align: center;
}

/* 触屏兜底：进一步加大触摸目标与字号 */
@media (pointer: coarse) {
  .tt-input {
    font-size: 16px;
  }

  .tt-cal {
    width: 48px;
  }

  .tt-th {
    height: 48px;
  }

  .tt-th-text {
    font-size: 14px;
  }
}

</style>

<style>
/* ===== 深色主题适配（暗色 Excel 风格，跟随 html.theme-dark） =====
   独立非 scoped 块：scoped + :global(html.theme-dark) 前缀规则在构建压缩时
   会被错误合并丢失选择器（产物变成 html.theme-dark{...}），导致表格深色失效 */
html.theme-dark .tt {
  background: #232323;
}

html.theme-dark .tt-head {
  background: #2e2e2e;
  border-bottom-color: #3a3a3a;
}

html.theme-dark .tt-th-text {
  color: #b8b8b8;
}

html.theme-dark .tt-tr {
  border-bottom-color: #333333;
}

html.theme-dark .tt-td {
  border-right-color: #333333;
}

html.theme-dark .tt-input {
  color: #e8e8e8;
}

html.theme-dark .tt-input::placeholder {
  color: #7c7c7c;
}

html.theme-dark .tt-input:focus {
  background: rgba(76, 194, 255, 0.1);
}

html.theme-dark .tt-cal {
  color: var(--accent-base, #4cc2ff);
}

html.theme-dark .tt-cal:hover {
  background: rgba(76, 194, 255, 0.12);
}

html.theme-dark .tt-empty {
  color: #7c7c7c;
}
</style>
