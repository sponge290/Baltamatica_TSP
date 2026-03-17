#!/usr/bin/env python3
"""
Python内置HTTP服务（极简部署方案）
功能：
1. 提供前端静态文件服务
2. 实现API请求转发到后端服务
3. 无需安装额外软件，开箱即用
"""
import http.server
import socketserver
import urllib.request
import urllib.error
import urllib.parse
import json
import sys
import os

# 配置
HOST = '0.0.0.0'
PORT = 8080
STATIC_DIR = '../frontend/dist'  # 前端静态文件目录
API_BASE_URL = 'http://localhost:8000'  # 后端API服务地址

class SimpleHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # 更改工作目录到静态文件目录
        os.chdir(os.path.join(os.path.dirname(__file__), STATIC_DIR))
        super().__init__(*args, **kwargs)
    
    def do_GET(self):
        # 处理API请求
        if self.path.startswith('/api'):
            self.handle_api_request('GET')
        else:
            # 处理静态文件请求
            super().do_GET()
    
    def do_POST(self):
        # 处理API请求
        if self.path.startswith('/api'):
            self.handle_api_request('POST')
        else:
            # 处理静态文件POST请求（通常不需要）
            self.send_error(405, "Method Not Allowed")
    
    def do_OPTIONS(self):
        # 处理CORS预检请求
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def handle_api_request(self, method):
        """处理API请求并转发到后端服务"""
        try:
            # 构建完整的API URL
            api_url = API_BASE_URL + self.path
            
            # 构建请求头
            headers = {}
            for key, value in self.headers.items():
                if key not in ['Host', 'Content-Length']:
                    headers[key] = value
            
            # 读取请求体
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length) if content_length > 0 else b''
            
            # 创建请求对象
            req = urllib.request.Request(api_url, data=body, headers=headers, method=method)
            
            # 发送请求到后端API
            with urllib.request.urlopen(req, timeout=30) as response:
                # 获取响应
                response_data = response.read()
                response_status = response.getcode()
                response_headers = dict(response.getheaders())
                
                # 发送响应给客户端
                self.send_response(response_status)
                for key, value in response_headers.items():
                    if key.lower() not in ['content-encoding', 'content-length']:
                        self.send_header(key, value)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(response_data)
                
        except urllib.error.HTTPError as e:
            # 处理HTTP错误
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            error_data = json.dumps({"error": str(e), "code": e.code})
            self.wfile.write(error_data.encode('utf-8'))
            
        except urllib.error.URLError as e:
            # 处理连接错误（如API服务未启动）
            self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            error_data = json.dumps({"error": f"API服务不可用: {str(e)}", "code": 503})
            self.wfile.write(error_data.encode('utf-8'))
            
        except Exception as e:
            # 处理其他错误
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            error_data = json.dumps({"error": f"服务器内部错误: {str(e)}", "code": 500})
            self.wfile.write(error_data.encode('utf-8'))
    
    def log_message(self, format, *args):
        """自定义日志格式"""
        print(f"[{self.log_date_time_string()}] {format % args}")

def main():
    """主函数"""
    print(f"启动Python内置HTTP服务...")
    print(f"服务地址: http://{HOST}:{PORT}")
    print(f"静态文件目录: {os.path.abspath(os.path.join(os.path.dirname(__file__), STATIC_DIR))}")
    print(f"API转发地址: {API_BASE_URL}")
    print("按 Ctrl+C 停止服务")
    print("=" * 60)
    
    try:
        # 创建服务器
        with socketserver.TCPServer((HOST, PORT), SimpleHTTPRequestHandler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
    except Exception as e:
        print(f"启动服务失败: {str(e)}")
        sys.exit(1)

if __name__ == '__main__':
    main()