import { createApp } from 'vue';
import App from './App.vue';
import { createI18n, i18nKey } from '@winui/components/i18n/index';
import '@winui/styles/theme.css';
import './global.css';
import { initTheme } from './theme';

// 应用保存的主题配置（system/light/dark），无需阻塞挂载
initTheme();

// 布局与弹层控件沿用 WinUIonWeb 全局注册（对应上游 src/main.ts 中的注册项）
import Canvas from '@winui/components/Canvas.vue';
import Grid from '@winui/components/Grid.vue';
import ColumnDefinition from '@winui/components/ColumnDefinition.vue';
import GridColumnDefinitions from '@winui/components/GridColumnDefinitions.vue';
import GridRowDefinitions from '@winui/components/GridRowDefinitions.vue';
import RowDefinition from '@winui/components/RowDefinition.vue';
import RelativePanel from '@winui/components/RelativePanel.vue';
import StackPanel from '@winui/components/StackPanel.vue';
import VariableSizedWrapGrid from '@winui/components/VariableSizedWrapGrid.vue';
import Border from '@winui/components/Border.vue';
import Rectangle from '@winui/components/Rectangle.vue';
import Image from '@winui/components/Image.vue';
import FontIcon from '@winui/components/FontIcon.vue';
import SymbolIcon from '@winui/components/SymbolIcon.vue';
import { MenuFlyout, MenuFlyoutItem, MenuFlyoutItemIcon } from '@winui/components/DropDownButtonProperties';

const app = createApp(App);
const i18n = createI18n('zh-CN');

app.component('Grid', Grid);
app.component('Grid.ColumnDefinitions', GridColumnDefinitions);
app.component('Grid.RowDefinitions', GridRowDefinitions);
app.component('ColumnDefinition', ColumnDefinition);
app.component('RowDefinition', RowDefinition);
app.component('StackPanel', StackPanel);
app.component('Canvas', Canvas);
app.component('RelativePanel', RelativePanel);
app.component('VariableSizedWrapGrid', VariableSizedWrapGrid);
app.component('Border', Border);
app.component('Rectangle', Rectangle);
app.component('Image', Image);
app.component('FontIcon', FontIcon);
app.component('SymbolIcon', SymbolIcon);
app.component('SymbolIconSource', SymbolIcon);
app.component('MenuFlyout', MenuFlyout);
app.component('MenuFlyoutItem', MenuFlyoutItem);
app.component('MenuFlyoutItem.Icon', MenuFlyoutItemIcon);

app.provide(i18nKey, i18n);
app.config.globalProperties.$t = i18n.t;
app.mount('#app');