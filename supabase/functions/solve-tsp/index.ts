import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { solveDP } from "./algorithms/dp.ts";
import { solveAStar } from "./algorithms/astar.ts";
import { solveGA } from "./algorithms/ga.ts";
import { validateRequest } from "./utils/constraints.ts";
import type { SolveTSPRequest, TSPSolution } from "./utils/types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    const request: SolveTSPRequest = await req.json();
    
    const validation = validateRequest(request);
    if (!validation.valid) {
      return new Response(JSON.stringify({ code: 400, msg: validation.error }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const startTime = Date.now();
    let solution: TSPSolution;
    
    switch (request.algorithm) {
      case "DP":
        solution = await solveDP(request);
        break;
      case "A*":
        solution = await solveAStar(request);
        break;
      case "GA":
        solution = await solveGA(request);
        break;
      default:
        throw new Error("不支持的算法类型");
    }
    
    solution.exec_time = Date.now() - startTime;

    // 同步写库并返回 solution_id，方便前端“保存/分享/历史”闭环验证
    const { data: solData, error: solError } = await supabase
      .from("route_solutions")
      .insert([{
        case_id: request.case_id,
        algorithm: request.algorithm,
        total_cost: solution.total_cost,
        total_time: solution.total_time,
        reliability: solution.reliability,
        exec_time: solution.exec_time,
        route_sequence: solution.best_path,
        is_public: false
      }])
      .select("solution_id")
      .single();

    if (solError) throw solError;

    const { error: nodesError } = await supabase
      .from("route_nodes")
      .insert(solution.nodes.map((node, idx) => ({
        solution_id: solData.solution_id,
        city_id: node.city_id,
        visit_order: idx + 1,
        arrival_time: node.arrival_time,
        departure_time: node.departure_time,
        weather_condition: node.weather_condition
      })));

    if (nodesError) throw nodesError;

    // @ts-expect-error: extend response payload for frontend
    (solution as any).solution_id = solData.solution_id;

    return new Response(JSON.stringify({ code: 200, data: solution }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (error) {
    console.error("执行失败:", error);
    return new Response(JSON.stringify({ 
      code: 500, 
      msg: "执行失败", 
      error: error instanceof Error ? error.message : "未知错误" 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
