#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据导入工具
用于批量导入基础数据到Supabase数据库
"""

import pandas as pd
from supabase import create_client, Client
from datetime import datetime
import json
import argparse

class DataImporter:
    def __init__(self, supabase_url: str, supabase_key: str):
        """初始化Supabase客户端"""
        self.supabase: Client = create_client(supabase_url, supabase_key)
        print(f"成功连接到Supabase: {supabase_url}")
    
    def import_cities(self, file_path: str):
        """批量导入城市数据"""
        print(f"开始导入城市数据: {file_path}")
        try:
            df = pd.read_csv(file_path)
            # 数据清洗和标准化
            cities_data = []
            for _, row in df.iterrows():
                city = {
                    'city_id': int(row['city_id']),
                    'city_name': str(row['city_name']),
                    'latitude': float(row['latitude']),
                    'longitude': float(row['longitude']),
                    'min_visits': int(row.get('min_visits', 1))
                }
                cities_data.append(city)
            
            # 批量写入，冲突时更新
            response = self.supabase.table("cities").upsert(cities_data, on_conflict="city_id").execute()
            print(f"成功导入{len(cities_data)}条城市数据")
        except Exception as e:
            print(f"导入城市数据失败: {e}")
    
    def import_weather_stations(self, file_path: str):
        """批量导入气象站数据"""
        print(f"开始导入气象站数据: {file_path}")
        try:
            df = pd.read_csv(file_path)
            stations_data = []
            for _, row in df.iterrows():
                station = {
                    'station_id': int(row['station_id']),
                    'station_name': str(row['station_name']),
                    'latitude': float(row['latitude']),
                    'longitude': float(row['longitude']),
                    'elevation': float(row.get('elevation', 0)) if pd.notna(row.get('elevation')) else None
                }
                stations_data.append(station)
            
            response = self.supabase.table("weather_stations").upsert(stations_data, on_conflict="station_id").execute()
            print(f"成功导入{len(stations_data)}条气象站数据")
        except Exception as e:
            print(f"导入气象站数据失败: {e}")
    
    def import_weather_observations(self, file_path: str, batch_size: int = 1000):
        """批量导入天气观测数据，分批次写入"""
        print(f"开始导入天气观测数据: {file_path}")
        try:
            df = pd.read_csv(file_path)
            total_count = len(df)
            print(f"总数据量: {total_count}")
            
            # 分批次写入
            for i in range(0, total_count, batch_size):
                batch = df.iloc[i:i+batch_size]
                observations_data = []
                
                for _, row in batch.iterrows():
                    observation = {
                        'station_id': int(row['station_id']),
                        'observation_time': pd.to_datetime(row['observation_time']).strftime('%Y-%m-%d %H:%M:%S%z'),
                        'temperature': float(row['temperature']) if pd.notna(row['temperature']) else None,
                        'precipitation': float(row['precipitation']) if pd.notna(row['precipitation']) else None,
                        'wind_speed': float(row['wind_speed']) if pd.notna(row['wind_speed']) else None,
                        'wind_direction': float(row['wind_direction']) if pd.notna(row['wind_direction']) else None,
                        'humidity': float(row['humidity']) if pd.notna(row['humidity']) else None,
                        'visibility': float(row['visibility']) if pd.notna(row['visibility']) else None,
                        'weather_condition': str(row['weather_condition']) if pd.notna(row['weather_condition']) else None
                    }
                    observations_data.append(observation)
                
                response = self.supabase.table("weather_observations").insert(observations_data).execute()
                print(f"已导入{i+len(batch)}/{total_count}条观测数据")
            
            print("天气观测数据导入完成")
        except Exception as e:
            print(f"导入天气观测数据失败: {e}")
    
    def import_road_segments(self, file_path: str):
        """批量导入路段数据"""
        print(f"开始导入路段数据: {file_path}")
        try:
            df = pd.read_csv(file_path)
            segments_data = []
            for _, row in df.iterrows():
                segment = {
                    'segment_id': int(row['segment_id']),
                    'start_city_id': int(row['start_city_id']),
                    'end_city_id': int(row['end_city_id']),
                    'distance': float(row['distance']),
                    'road_type': str(row['road_type']) if pd.notna(row['road_type']) else None,
                    'speed_limit': float(row['speed_limit'])
                }
                segments_data.append(segment)
            
            response = self.supabase.table("road_segments").upsert(segments_data, on_conflict="segment_id").execute()
            print(f"成功导入{len(segments_data)}条路段数据")
        except Exception as e:
            print(f"导入路段数据失败: {e}")
    
    def import_test_cases(self, file_path: str):
        """批量导入测试用例数据"""
        print(f"开始导入测试用例数据: {file_path}")
        try:
            df = pd.read_csv(file_path)
            test_cases_data = []
            for _, row in df.iterrows():
                # 解析city_ids数组
                city_ids_str = str(row['city_ids'])
                # 处理不同格式的数组表示
                if city_ids_str.startswith('[') and city_ids_str.endswith(']'):
                    city_ids = json.loads(city_ids_str)
                else:
                    # 假设是逗号分隔的字符串
                    city_ids = [int(x.strip()) for x in city_ids_str.split(',')]
                
                test_case = {
                    'case_id': int(row['case_id']),
                    'case_name': str(row['case_name']),
                    'case_scale': str(row['case_scale']),
                    'city_ids': city_ids,
                    'description': str(row['description']) if pd.notna(row['description']) else None,
                    'is_default': bool(row.get('is_default', False))
                }
                test_cases_data.append(test_case)
            
            response = self.supabase.table("test_cases").upsert(test_cases_data, on_conflict="case_id").execute()
            print(f"成功导入{len(test_cases_data)}条测试用例数据")
        except Exception as e:
            print(f"导入测试用例数据失败: {e}")
    
    def close(self):
        """关闭客户端连接"""
        try:
            self.supabase.auth.sign_out()
            print("已关闭Supabase连接")
        except:
            pass

def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='数据导入工具')
    parser.add_argument('--url', required=True, help='Supabase项目URL')
    parser.add_argument('--key', required=True, help='Supabase服务密钥')
    parser.add_argument('--cities', help='城市数据CSV文件路径')
    parser.add_argument('--stations', help='气象站数据CSV文件路径')
    parser.add_argument('--observations', help='天气观测数据CSV文件路径')
    parser.add_argument('--segments', help='路段数据CSV文件路径')
    parser.add_argument('--test-cases', help='测试用例数据CSV文件路径')
    parser.add_argument('--batch-size', type=int, default=1000, help='批量导入大小')
    
    args = parser.parse_args()
    
    # 初始化导入器
    importer = DataImporter(args.url, args.key)
    
    # 导入数据
    if args.cities:
        importer.import_cities(args.cities)
    if args.stations:
        importer.import_weather_stations(args.stations)
    if args.observations:
        importer.import_weather_observations(args.observations, args.batch_size)
    if args.segments:
        importer.import_road_segments(args.segments)
    if args.test_cases:
        importer.import_test_cases(args.test_cases)
    
    # 关闭连接
    importer.close()
    print("数据导入任务完成")

if __name__ == "__main__":
    main()