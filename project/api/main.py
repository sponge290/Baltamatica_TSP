from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
from psycopg2.extras import RealDictCursor
import json

app = FastAPI()

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://192.168.1.100:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 数据库连接
conn = psycopg2.connect(
    host="localhost",
    database="tsp_db",
    user="tsp_user",
    password="tsp_password"
)

# 基础数据接口
@app.get("/api/cities")
async def get_cities():
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM cities")
            cities = cur.fetchall()
        return {"data": cities}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/weather-observations")
async def get_weather_observations():
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM weather_observations")
            observations = cur.fetchall()
        return {"data": observations}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/road-segments")
async def get_road_segments():
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM road_segments")
            segments = cur.fetchall()
        return {"data": segments}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 测试用例接口
@app.get("/api/test-cases")
async def get_test_cases():
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM test_cases")
            test_cases = cur.fetchall()
        return {"data": test_cases}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/test-cases/{case_id}")
async def get_test_case(case_id: str):
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM test_cases WHERE case_id = %s", (case_id,))
            test_case = cur.fetchone()
        if not test_case:
            raise HTTPException(status_code=404, detail="Test case not found")
        return {"data": test_case}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 求解结果接口
@app.post("/api/solutions")
async def create_solution(solution: dict):
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 插入路径解表
            cur.execute("""
                INSERT INTO route_solutions (
                    case_id, algorithm, total_cost, total_time, 
                    reliability, exec_time, route_sequence, is_public
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING solution_id
            """, (
                solution.get('case_id'),
                solution.get('algorithm'),
                solution.get('total_cost'),
                solution.get('total_time'),
                solution.get('reliability'),
                solution.get('exec_time'),
                json.dumps(solution.get('path')),
                solution.get('is_public', False)
            ))
            solution_id = cur.fetchone()['solution_id']
            
            # 插入路径节点表
            if solution.get('nodes'):
                for i, node in enumerate(solution['nodes']):
                    cur.execute("""
                        INSERT INTO route_nodes (
                            solution_id, city_id, visit_order, 
                            arrival_time, departure_time, weather_condition
                        ) VALUES (%s, %s, %s, %s, %s, %s)
                    """, (
                        solution_id,
                        node.get('city_id'),
                        i + 1,
                        node.get('arrival_time'),
                        node.get('departure_time'),
                        node.get('weather_condition')
                    ))
            
            conn.commit()
        return {"solution_id": solution_id}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/solutions")
async def get_solutions():
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM route_solutions ORDER BY created_at DESC")
            solutions = cur.fetchall()
        return {"data": solutions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/solutions/{solution_id}")
async def get_solution(solution_id: str):
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM route_solutions WHERE solution_id = %s", (solution_id,))
            solution = cur.fetchone()
            if not solution:
                raise HTTPException(status_code=404, detail="Solution not found")
            
            cur.execute("SELECT * FROM route_nodes WHERE solution_id = %s ORDER BY visit_order", (solution_id,))
            nodes = cur.fetchall()
            solution['nodes'] = nodes
        return {"data": solution}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/solutions/{solution_id}/share")
async def update_share_status(solution_id: str, is_public: bool):
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE route_solutions SET is_public = %s WHERE solution_id = %s",
                (is_public, solution_id)
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Solution not found")
            conn.commit()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/solutions/{solution_id}")
async def delete_solution(solution_id: str):
    try:
        with conn.cursor() as cur:
            # 先删除关联的路径节点
            cur.execute("DELETE FROM route_nodes WHERE solution_id = %s", (solution_id,))
            # 再删除路径解
            cur.execute("DELETE FROM route_solutions WHERE solution_id = %s", (solution_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Solution not found")
            conn.commit()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

# 算法对比接口
@app.get("/api/solutions/compare")
async def compare_solutions(case_id: str):
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM route_solutions WHERE case_id = %s ORDER BY algorithm",
                (case_id,)
            )
            solutions = cur.fetchall()
        return {"data": solutions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 用户认证接口
@app.post("/api/auth/login")
async def login(credentials: dict):
    # 简化实现，实际应使用密码哈希和JWT
    return {"access_token": "test_token", "user": {"id": 1, "email": credentials.get("email")}}

@app.post("/api/auth/register")
async def register(user_data: dict):
    # 简化实现，实际应使用密码哈希
    return {"user": {"id": 1, "email": user_data.get("email")}}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)