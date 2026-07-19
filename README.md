# Steam 创意工坊 Mod 工具

> 一个 Tampermonkey 用户脚本，让你在 Steam 创意工坊页面里批量提取、收藏、管理模组与合集。

## 简介

本脚本为 Steam 创意工坊页面（浏览页、合集页、模组详情页、个人订阅页）注入一组轻量工具，解决「批量复制模组 ID / SteamCMD 命令」「统一管理已收藏的模组与合集」「一键导出清单」这类高频痛点。无需离开页面、无需手动打开控制台，所有操作在悬浮按钮和侧边管理面板内即可完成。

- **脚本名称**：Steam 创意工坊 Mod 工具 - 模组 ID 批量提取与导出
- **版本**：3.0
- **运行环境**：Tampermonkey / Violentmonkey 等支持 `@grant` 的脚本管理器
- **适用站点**：`steamcommunity.com` 下全部创意工坊相关页面
![Uploading Steam 创意工坊脚本 · UI 预览 - [].png…]()

## 功能

- **海报悬浮层**
  - 模组卡片：`复制 ID`、`复制 SteamCMD`、`加入 / 移出收藏夹`
  - 合集卡片：`收藏合集`（带已收藏状态）
- **收藏面板**
  - 合集页：批量提取合集内所有模组并一键收藏
  - 模组详情页：单页快速收藏 / 取消
  - 工坊浏览页：浮动工具条，支持当前页 / 勾选批量收藏
- **列表管理器（侧边面板）**
  - 模组 / 合集双视图切换
  - 实时搜索（按名称或 ID）
  - 按更新时间排序、按「有 / 无更新时间」筛选
  - 批量勾选、全选 / 取消
  - 批量导出：仅名称 / 仅 ID / 仅链接 / 完整信息（可导出勾选、本页或全部）
  - 批量删除确认栏（误操作保护）
  - 数据导入，跨设备恢复收藏清单
- **自动识别**
  - 通过精准 URL 正则识别浏览页、合集页、模组详情页、个人订阅页
  - 兼容 Steam 单页应用（SPA）导航，切换页面无需刷新脚本

## 界面设计

- **风格**：沿用 Steam 暗色 UI（深蓝灰底色 + 青色强调色），与页面原生观感一致，不突兀。
- **管理器面板**：右侧固定浮层，含标题栏、视图切换 Tab、工具栏（搜索框 + 筛选下拉 + 检查更新按钮 + 全选 + 导出菜单）、可滚动数据表格（名称 / ID / 更新时间 / 添加时间 / 操作）。
- **悬浮层**：覆盖在创意工坊卡片海报上，半透明蒙版 + 圆形图标按钮，鼠标悬停即显、移出不挡内容。
- **Toast 提示**：右下角轻量通知，分成功 / 警告 / 信息 / 错误四种状态，自动消失。
- **响应式**：面板与卡片布局适配不同宽度，按钮与下拉框宽度对齐（如检查更新按钮与筛选框统一 139px）。
- **可访问性**：按钮带 `title` 提示，操作有状态反馈（已收藏打勾），交互均有视觉确认。

## MIT 开源声明

```
MIT License

Copyright (c) 2026 godsq

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

你可以自由使用、修改、分发本脚本，只需保留上述版权与许可声明。脚本本身已在文件头声明 `@license MIT`。
