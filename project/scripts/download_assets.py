#!/usr/bin/env python3
"""
下载前端所需的依赖文件，实现本地化部署
"""
import os
import requests

# 资源配置
RESOURCES = [
    {
        'url': 'https://cdn.tailwindcss.com',
        'path': 'project/frontend/public/assets/css/tailwind.min.css'
    },
    {
        'url': 'https://cdn.jsdelivr.net/npm/font-awesome@4.7.0/css/font-awesome.min.css',
        'path': 'project/frontend/public/assets/css/font-awesome.min.css'
    },
    {
        'url': 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
        'path': 'project/frontend/public/assets/js/chart.umd.min.js'
    }
]

def download_file(url, save_path):
    """下载文件并保存到指定路径"""
    try:
        print(f"下载: {url}")
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        # 确保目录存在
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        
        # 保存文件
        with open(save_path, 'wb') as f:
            f.write(response.content)
        
        print(f"保存到: {save_path}")
        return True
    except Exception as e:
        print(f"下载失败: {e}")
        return False

def main():
    """主函数"""
    print("开始下载前端依赖文件...")
    success_count = 0
    
    for resource in RESOURCES:
        if download_file(resource['url'], resource['path']):
            success_count += 1
    
    print(f"\n下载完成: {success_count}/{len(RESOURCES)} 个文件成功")
    
    # 创建占位文件，确保即使下载失败也能正常构建
    for resource in RESOURCES:
        if not os.path.exists(resource['path']):
            print(f"创建占位文件: {resource['path']}")
            os.makedirs(os.path.dirname(resource['path']), exist_ok=True)
            with open(resource['path'], 'w') as f:
                if resource['path'].endswith('.css'):
                    f.write('/* 占位CSS文件 */')
                elif resource['path'].endswith('.js'):
                    f.write('// 占位JS文件')

if __name__ == '__main__':
    main()