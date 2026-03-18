import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { solveDP } from "./algorithms/dp.ts";
import { solveAStar } from "./algorithms/astar.ts";
import { solveGA } from "./algorithms/ga.ts";
import { validateRequest } from "./utils/constraints.ts";
import type { SolveTSPRequest, TSPSolution } from "./utils/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // Must include custom headers used by Supabase + browser clients, otherwise the browser will block POST after preflight.
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
};

const sbUrl =
  Deno.env.get("EDGE_SUPABASE_URL") ??
  Deno.env.get("SUPABASE_URL"); // legacy fallback (some environments may still provide it)
const sbServiceRoleKey =
  Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // legacy fallback

if (!sbUrl || !sbServiceRoleKey) {
  throw new Error(
    "Missing Edge Function secrets: EDGE_SUPABASE_URL and EDGE_SUPABASE_SERVICE_ROLE_KEY"
  );
}

const supabase = createClient(sbUrl, sbServiceRoleKey);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders,
    });
  }

  try {
    let request: SolveTSPRequest;
    try {
      request = await req.json();
    } catch (parseError) {
      console.error("解析请求体失败:", parseError);
      return new Response(JSON.stringify({
        code: 400,
        msg: "请求体不是合法的 JSON",
        phase: "parse_json",
        error: parseError instanceof Error
          ? { name: parseError.name, message: parseError.message, stack: parseError.stack }
          : { message: String(parseError) }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    
    const validation = validateRequest(request);
    if (!validation.valid) {
      return new Response(JSON.stringify({ code: 400, msg: validation.error }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
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

    // 尝试写库（用于历史/分享）；写库失败不影响求解结果返回，避免前端“请求失败”
    try {
      const { data: solData, error: solError } = await supabase
        .from("tsp_solutions")
        .insert([{
          case_id: request.case_id,
          algorithm: request.algorithm,
          // The current solver uses time-based cost; store it as distance for compatibility with existing schema.
          total_distance: solution.total_cost,
          total_time: solution.total_time,
          execution_time: solution.exec_time,
          route: solution.best_path,
          weather_impact: {
            reliability: solution.reliability,
            process_data: solution.process_data ?? null
          }
        }])
        .select("solution_id")
        .single();

      if (solError) throw solError;

      // @ts-expect-error: extend response payload for frontend
      (solution as any).solution_id = solData.solution_id;
    } catch (dbError) {
      console.error("写库失败(忽略返回结果):", dbError);
      // @ts-expect-error: extend response payload for frontend
      (solution as any).solution_id = null;
    }

    return new Response(JSON.stringify({ code: 200, data: solution }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch (error) {
    console.error("执行失败:", error);
    return new Response(JSON.stringify({ 
      code: 500, 
      msg: "执行失败", 
      phase: "unhandled",
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
