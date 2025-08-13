// ==UserScript==
// @name          Bilibili视频下载器（简化版）
// @namespace     https://github.com/yourusername
// @version       1.0.0
// @description   简化版B站视频下载器，支持720p/1080p下载，自动记录到Excel
// @author        YourName
// @match         *://www.bilibili.com/video/av*
// @match         *://www.bilibili.com/video/BV*
// @require       https://static.hdslb.com/js/jquery.min.js
// @require       https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @grant         none
// ==/UserScript==

(function() {
    'use strict';
    
    // 简化版下载器类
    class SimpleBilibiliDownloader {
        constructor() {
            this.downloadRecords = [];
            this.init();
        }
        
        init() {
            this.addDownloadButton();
            this.loadExistingRecords();
        }
        
        // 添加下载按钮到页面
        addDownloadButton() {
            if ($('#simple_download_btn').length > 0) return;
            
            const button = $(`
                <div id="simple_download_btn" style="
                    position: fixed;
                    top: 100px;
                    right: 20px;
                    z-index: 10000;
                    background: #00a1d6;
                    color: white;
                    padding: 12px 18px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 16px;
                    font-weight: bold;
                    box-shadow: 0 4px 12px rgba(0,161,214,0.3);
                    transition: all 0.3s ease;
                    user-select: none;
                ">
                    <span>📥 下载视频</span>
                </div>
            `);
            
            button.hover(
                function() { $(this).css('transform', 'scale(1.05)'); },
                function() { $(this).css('transform', 'scale(1)'); }
            );
            
            button.on('click', () => this.downloadVideo());
            $('body').append(button);
        }
        
        // 从localStorage加载已有记录
        loadExistingRecords() {
            try {
                const saved = localStorage.getItem('bilibili_download_records');
                if (saved) {
                    this.downloadRecords = JSON.parse(saved);
                }
            } catch (error) {
                console.error('加载下载记录失败:', error);
                this.downloadRecords = [];
            }
        }
        
        // 保存记录到localStorage
        saveRecords() {
            try {
                localStorage.setItem('bilibili_download_records', JSON.stringify(this.downloadRecords));
            } catch (error) {
                console.error('保存下载记录失败:', error);
            }
        }
        
        // 获取视频信息
        getVideoInfo() {
            try {
                const state = window.__INITIAL_STATE__;
                if (!state || !state.videoData) {
                    throw new Error('无法获取视频信息');
                }
                
                const videoData = state.videoData;
                return {
                    title: videoData.title,
                    aid: videoData.aid,
                    bvid: videoData.bvid,
                    cid: videoData.cid,
                    pic: videoData.pic,
                    desc: videoData.desc,
                    duration: videoData.duration,
                    owner: videoData.owner.name,
                    url: window.location.href,
                    pages: videoData.pages || []
                };
            } catch (error) {
                console.error('获取视频信息失败:', error);
                return null;
            }
        }
        
        // 获取播放地址
        async getPlayUrl(videoInfo, quality = 80) {
            const api_url = `https://api.bilibili.com/x/player/playurl`;
            const params = {
                avid: videoInfo.aid,
                bvid: videoInfo.bvid,
                cid: videoInfo.cid,
                qn: quality,
                fnver: 0,
                fnval: 4048,
                fourk: 1
            };
            
            try {
                const response = await $.ajax({
                    url: api_url,
                    data: params,
                    type: 'GET',
                    dataType: 'json',
                    xhrFields: { withCredentials: true }
                });
                
                if (response.code !== 0) {
                    throw new Error(response.message || '获取播放地址失败');
                }
                
                const result = response.data;
                
                // 处理DASH格式
                if (result.dash && result.dash.video && result.dash.video.length > 0) {
                    return {
                        type: 'dash',
                        video_url: result.dash.video[0].base_url,
                        audio_url: result.dash.audio && result.dash.audio[0] ? result.dash.audio[0].base_url : null,
                        quality: result.quality,
                        format: 'dash'
                    };
                }
                
                // 处理直接格式
                if (result.durl && result.durl.length > 0) {
                    return {
                        type: 'direct',
                        url: result.durl[0].url,
                        quality: result.quality,
                        format: 'mp4'
                    };
                }
                
                throw new Error('无法解析播放地址');
            } catch (error) {
                console.error('获取播放地址失败:', error);
                return null;
            }
        }
        
        // 创建目录结构并下载文件
        async downloadFile(url, filename, directory = 'cut_video') {
            try {
                this.showMessage('正在下载: ' + filename, 'info');
                
                const response = await fetch(url, {
                    headers: {
                        'Referer': 'https://www.bilibili.com',
                        'User-Agent': navigator.userAgent
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`下载失败: ${response.status}`);
                }
                
                const blob = await response.blob();
                
                // 使用 File System Access API (如果支持)
                if ('showDirectoryPicker' in window) {
                    await this.saveWithFileSystemAPI(blob, filename, directory);
                } else {
                    // 降级到传统下载方式
                    await this.saveWithDownloadAPI(blob, filename);
                }
                
                return true;
            } catch (error) {
                console.error('下载文件失败:', error);
                this.showMessage('下载失败: ' + error.message, 'error');
                return false;
            }
        }
        
        // 使用 File System Access API 保存文件
        async saveWithFileSystemAPI(blob, filename, directory) {
            try {
                // 获取或创建根目录
                const rootDirHandle = await window.showDirectoryPicker();
                
                // 创建项目目录（以视频标题命名）
                const projectName = this.sanitizeFileName(this.getVideoInfo().title);
                const projectDirHandle = await this.getOrCreateDirectory(rootDirHandle, projectName);
                
                // 创建 cut_video 和 original_video 目录
                const cutVideoDirHandle = await this.getOrCreateDirectory(projectDirHandle, 'cut_video');
                const originalVideoDirHandle = await this.getOrCreateDirectory(projectDirHandle, 'original_video');
                
                // 保存文件到 cut_video 目录
                const targetDir = directory === 'cut_video' ? cutVideoDirHandle : originalVideoDirHandle;
                const fileHandle = await targetDir.getFileHandle(filename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                
                return `${projectName}/${directory}/${filename}`;
            } catch (error) {
                console.error('使用 File System API 保存失败:', error);
                // 降级到传统方式
                return await this.saveWithDownloadAPI(blob, filename);
            }
        }
        
        // 传统下载方式
        async saveWithDownloadAPI(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            return `Downloads/${filename}`;
        }
        
        // 获取或创建目录
        async getOrCreateDirectory(parentHandle, dirName) {
            try {
                return await parentHandle.getDirectoryHandle(dirName);
            } catch (error) {
                return await parentHandle.getDirectoryHandle(dirName, { create: true });
            }
        }
        
        // 清理文件名
        sanitizeFileName(name) {
            return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
        }
        
        // 下载封面
        async downloadCover(coverUrl, projectPath) {
            if (!coverUrl) return null;
            
            try {
                const response = await fetch(coverUrl);
                const blob = await response.blob();
                
                const ext = coverUrl.includes('.png') ? '.png' : 
                           coverUrl.includes('.gif') ? '.gif' : '.jpg';
                const filename = `cover${ext}`;
                
                if ('showDirectoryPicker' in window) {
                    // 这里需要访问已经选择的目录，实际实现时需要保存目录句柄
                    // 为简化，暂时使用传统下载
                    await this.saveWithDownloadAPI(blob, filename);
                    return `${projectPath}/${filename}`;
                } else {
                    await this.saveWithDownloadAPI(blob, filename);
                    return `Downloads/${filename}`;
                }
            } catch (error) {
                console.error('下载封面失败:', error);
                return null;
            }
        }
        
        // 主下载函数
        async downloadVideo() {
            try {
                this.showMessage('正在获取视频信息...', 'info');
                
                // 获取视频信息
                const videoInfo = this.getVideoInfo();
                if (!videoInfo) {
                    this.showMessage('获取视频信息失败', 'error');
                    return;
                }
                
                this.showMessage('正在获取下载地址...', 'info');
                
                // 尝试1080p，失败则尝试720p
                let playInfo = await this.getPlayUrl(videoInfo, 80); // 1080p
                if (!playInfo) {
                    this.showMessage('1080p不可用，尝试720p...', 'warning');
                    playInfo = await this.getPlayUrl(videoInfo, 64); // 720p
                }
                
                if (!playInfo) {
                    this.showMessage('获取下载地址失败', 'error');
                    return;
                }
                
                this.showMessage(`开始下载 ${this.getQualityText(playInfo.quality)} 画质`, 'success');
                
                // 下载视频文件
                const timestamp = new Date().toISOString();
                const projectName = this.sanitizeFileName(videoInfo.title);
                let downloadedFiles = [];
                let projectPath = `${projectName}`;
                
                if (playInfo.type === 'dash') {
                    // DASH格式需要分别下载视频和音频
                    if (playInfo.video_url) {
                        const videoFilename = `${projectName}_video.m4s`;
                        const success = await this.downloadFile(playInfo.video_url, videoFilename, 'cut_video');
                        if (success) downloadedFiles.push(`cut_video/${videoFilename}`);
                    }
                    
                    if (playInfo.audio_url) {
                        const audioFilename = `${projectName}_audio.m4s`;
                        const success = await this.downloadFile(playInfo.audio_url, audioFilename, 'cut_video');
                        if (success) downloadedFiles.push(`cut_video/${audioFilename}`);
                    }
                } else {
                    // 直接格式
                    const videoFilename = `${projectName}.mp4`;
                    const success = await this.downloadFile(playInfo.url, videoFilename, 'cut_video');
                    if (success) downloadedFiles.push(`cut_video/${videoFilename}`);
                }
                
                // 下载封面
                const coverPath = await this.downloadCover(videoInfo.pic, projectPath);
                
                // 记录下载信息
                const downloadRecord = {
                    title: videoInfo.title,
                    url: videoInfo.url,
                    cover_url: videoInfo.pic,
                    cover_path: coverPath,
                    video_files: downloadedFiles,
                    project_path: projectPath,
                    cut_video_path: `${projectPath}/cut_video`,
                    original_video_path: `${projectPath}/original_video`,
                    download_time: timestamp,
                    quality: this.getQualityText(playInfo.quality),
                    owner: videoInfo.owner,
                    duration: videoInfo.duration,
                    aid: videoInfo.aid,
                    bvid: videoInfo.bvid
                };
                
                // 添加到记录并保存
                this.downloadRecords.push(downloadRecord);
                this.saveRecords();
                
                // 导出到Excel
                this.exportToExcel();
                
                this.showMessage('下载完成！', 'success');
                
            } catch (error) {
                console.error('下载失败:', error);
                this.showMessage('下载失败: ' + error.message, 'error');
            }
        }
        
        // 导出到Excel
        exportToExcel() {
            try {
                // 准备Excel数据
                const excelData = this.downloadRecords.map(record => ({
                    '视频标题': record.title,
                    '视频网址': record.url,
                    '封面URL': record.cover_url,
                    '封面路径': record.cover_path || '',
                    '视频文件路径': record.video_files.join('; '),
                    '项目目录': record.project_path,
                    '剪辑目录': record.cut_video_path,
                    '原始目录': record.original_video_path,
                    '下载时间': record.download_time,
                    '视频质量': record.quality,
                    'UP主': record.owner,
                    '时长(秒)': record.duration,
                    'AID': record.aid,
                    'BVID': record.bvid
                }));
                
                // 创建工作簿
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.json_to_sheet(excelData);
                
                // 设置列宽
                const colWidths = [
                    { wch: 30 }, // 视频标题
                    { wch: 50 }, // 视频网址
                    { wch: 50 }, // 封面URL
                    { wch: 30 }, // 封面路径
                    { wch: 50 }, // 视频文件路径
                    { wch: 20 }, // 项目目录
                    { wch: 20 }, // 剪辑目录
                    { wch: 20 }, // 原始目录
                    { wch: 20 }, // 下载时间
                    { wch: 15 }, // 视频质量
                    { wch: 15 }, // UP主
                    { wch: 10 }, // 时长
                    { wch: 15 }, // AID
                    { wch: 15 }  // BVID
                ];
                ws['!cols'] = colWidths;
                
                XLSX.utils.book_append_sheet(wb, ws, "下载记录");
                
                // 导出Excel文件
                const timestamp = new Date().toISOString().slice(0, 10);
                XLSX.writeFile(wb, `bilibili_download_records_${timestamp}.xlsx`);
                
                this.showMessage('Excel记录已导出', 'success');
            } catch (error) {
                console.error('导出Excel失败:', error);
                this.showMessage('导出Excel失败: ' + error.message, 'error');
            }
        }
        
        // 获取画质描述
        getQualityText(quality) {
            const qualityMap = {
                127: "8K 超高清",
                120: "4K 超清",
                116: "1080P 60帧",
                112: "1080P 高码率",
                80: "1080P 高清",
                74: "720P 60帧",
                64: "720P 高清",
                48: "720P 高清(MP4)",
                32: "480P 清晰",
                16: "360P 流畅"
            };
            return qualityMap[quality] || `${quality}P`;
        }
        
        // 显示消息
        showMessage(message, type = 'info') {
            // 移除之前的消息
            $('#download_message').remove();
            
            const colors = {
                info: '#2196F3',
                success: '#4CAF50',
                error: '#F44336',
                warning: '#FF9800'
            };
            
            const messageDiv = $(`
                <div id="download_message" style="
                    position: fixed;
                    top: 160px;
                    right: 20px;
                    z-index: 10001;
                    background: ${colors[type]};
                    color: white;
                    padding: 12px 16px;
                    border-radius: 6px;
                    font-size: 14px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    max-width: 300px;
                    word-wrap: break-word;
                    animation: slideIn 0.3s ease;
                ">
                    ${message}
                </div>
                <style>
                    @keyframes slideIn {
                        from { transform: translateX(100%); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                </style>
            `);
            
            $('body').append(messageDiv);
            
            // 3秒后自动消失
            setTimeout(() => {
                messageDiv.fadeOut(() => messageDiv.remove());
            }, 3000);
        }
    }
    
    // 等待页面加载完成后初始化
    $(document).ready(() => {
        // 延迟一秒确保页面完全加载
        setTimeout(() => {
            try {
                new SimpleBilibiliDownloader();
                console.log('Bilibili简化下载器已加载');
            } catch (error) {
                console.error('初始化下载器失败:', error);
            }
        }, 1000);
    });
    
    // 添加全局样式
    $('head').append(`
        <style>
            #simple_download_btn:active {
                transform: scale(0.95) !important;
            }
            
            @media (max-width: 768px) {
                #simple_download_btn {
                    top: 50px !important;
                    right: 10px !important;
                    padding: 10px 14px !important;
                    font-size: 14px !important;
                }
            }
        </style>
    `);
    
})();