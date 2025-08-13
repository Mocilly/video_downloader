import os
import shutil
import json
import re
import requests
import pandas as pd
from pathlib import Path
import hashlib
from urllib.parse import quote
import time

class VideoManager:
    def __init__(self, source_dir, target_dir, excel_path="video_info.xlsx"):
        """
        初始化视频管理器
        :param source_dir: 源视频目录
        :param target_dir: 目标整理目录
        :param excel_path: Excel文件路径
        """
        self.source_dir = Path(source_dir)
        self.target_dir = Path(target_dir)
        self.excel_path = Path(excel_path)
        self.video_extensions = {'.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'}
        self.processed_videos = set()
        
        # 创建目标目录
        self.target_dir.mkdir(exist_ok=True)
        
        # 初始化或加载Excel文件
        self.init_excel()
    
    def init_excel(self):
        """初始化Excel文件"""
        if self.excel_path.exists():
            self.df = pd.read_excel(self.excel_path)
            # 加载已处理的视频到集合中
            if not self.df.empty:
                self.processed_videos = set(self.df['视频原片片名'].tolist())
        else:
            self.df = pd.DataFrame(columns=['视频标题', '视频网址', '视频封面', '视频原片片名'])
    
    def get_video_files(self):
        """获取源目录下的所有视频文件"""
        video_files = []
        for file_path in self.source_dir.rglob('*'):
            if file_path.is_file() and file_path.suffix.lower() in self.video_extensions:
                video_files.append(file_path)
        return video_files
    
    def clean_filename(self, filename):
        """清理文件名，移除不合法的字符"""
        # 移除文件扩展名
        name = filename.stem if hasattr(filename, 'stem') else os.path.splitext(filename)[0]
        # 移除或替换不合法字符
        cleaned = re.sub(r'[<>:"/\\|?*]', '_', name)
        return cleaned.strip()
    
    def create_video_directory(self, video_file):
        """为视频文件创建目录结构"""
        video_name = self.clean_filename(video_file.name)
        video_dir = self.target_dir / video_name
        
        # 检查是否已经处理过
        if video_file.name in self.processed_videos:
            print(f"视频 {video_file.name} 已经处理过，跳过...")
            return None
        
        # 创建目录结构
        video_dir.mkdir(exist_ok=True)
        cut_video_dir = video_dir / "cut_video"
        original_video_dir = video_dir / "original_video"
        
        cut_video_dir.mkdir(exist_ok=True)
        original_video_dir.mkdir(exist_ok=True)
        
        # 移动视频文件到cut_video目录
        target_path = cut_video_dir / video_file.name
        try:
            shutil.move(str(video_file), str(target_path))
            print(f"视频 {video_file.name} 已移动到 {target_path}")
            return video_dir, video_name
        except Exception as e:
            print(f"移动视频文件失败: {e}")
            return None
    
    def search_bilibili_video(self, title):
        """通过标题搜索B站视频信息"""
        try:
            # B站搜索API（简化版本，实际使用需要处理更多参数）
            search_url = f"https://api.bilibili.com/x/web-interface/search/all/v2"
            params = {
                'keyword': title,
                'page': 1,
                'pagesize': 1
            }
            
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            
            response = requests.get(search_url, params=params, headers=headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('code') == 0 and data.get('data', {}).get('result'):
                    video_results = data['data']['result'].get('video', {}).get('data', [])
                    if video_results:
                        video = video_results[0]
                        return {
                            'title': video.get('title', '').replace('<em class="keyword">', '').replace('</em>', ''),
                            'url': f"https://www.bilibili.com/video/{video.get('bvid', '')}",
                            'cover': video.get('pic', ''),
                            'bvid': video.get('bvid', '')
                        }
            
            return None
        except Exception as e:
            print(f"搜索视频信息失败: {e}")
            return None
    
    def download_cover(self, cover_url, save_path):
        """下载视频封面"""
        try:
            if not cover_url:
                return None
            
            response = requests.get(cover_url, timeout=10)
            if response.status_code == 200:
                cover_path = save_path / "cover.jpg"
                with open(cover_path, 'wb') as f:
                    f.write(response.content)
                return str(cover_path)
        except Exception as e:
            print(f"下载封面失败: {e}")
        return None
    
    def add_to_excel(self, video_info):
        """添加视频信息到Excel"""
        new_row = pd.DataFrame([video_info])
        self.df = pd.concat([self.df, new_row], ignore_index=True)
        
        # 保存到Excel文件
        self.df.to_excel(self.excel_path, index=False)
        print(f"视频信息已添加到Excel: {video_info['视频标题']}")
    
    def process_videos(self):
        """处理所有视频文件"""
        video_files = self.get_video_files()
        print(f"找到 {len(video_files)} 个视频文件")
        
        for video_file in video_files:
            print(f"\n处理视频: {video_file.name}")
            
            # 创建目录结构并移动文件
            result = self.create_video_directory(video_file)
            if not result:
                continue
                
            video_dir, video_name = result
            
            # 搜索视频信息
            print(f"搜索视频信息: {video_name}")
            video_info = self.search_bilibili_video(video_name)
            
            if video_info:
                # 下载封面
                cover_path = self.download_cover(video_info['cover'], video_dir)
                
                # 准备Excel数据
                excel_data = {
                    '视频标题': video_info['title'],
                    '视频网址': video_info['url'],
                    '视频封面': cover_path or video_info['cover'],
                    '视频原片片名': video_file.name
                }
                
                # 添加到Excel
                self.add_to_excel(excel_data)
                
                # 记录已处理的视频
                self.processed_videos.add(video_file.name)
            else:
                print(f"未找到视频信息: {video_name}")
                # 即使没找到信息也记录基本信息
                excel_data = {
                    '视频标题': video_name,
                    '视频网址': '',
                    '视频封面': '',
                    '视频原片片名': video_file.name
                }
                self.add_to_excel(excel_data)
                self.processed_videos.add(video_file.name)
            
            # 添加延迟避免请求过于频繁
            time.sleep(1)
    
    def generate_report(self):
        """生成处理报告"""
        print(f"\n=== 处理完成 ===")
        print(f"总共处理视频: {len(self.processed_videos)}")
        print(f"Excel文件位置: {self.excel_path.absolute()}")
        print(f"整理目录位置: {self.target_dir.absolute()}")


if __name__ == "__main__":
    """主函数"""
    # 配置路径
    SOURCE_DIR = r"C:\Users\Mocilly\Desktop\base_dic\online_video_downloead"
    TARGET_DIR = r"C:\Users\Mocilly\Desktop\base_dic\processing"
    EXCEL_PATH = r"C:\Users\Mocilly\Desktop\base_dic\info_excel_project\video_info.xlsx"

    if not os.path.exists(SOURCE_DIR):
        print("源目录不存在!")

    
    # 创建视频管理器
    manager = VideoManager(SOURCE_DIR, TARGET_DIR, EXCEL_PATH)
    
    # 处理视频
    manager.process_videos()
    
    # 生成报告
    manager.generate_report()