const { pgQuery } = require("../db/postgres");

const columns = "id::text,owner,team_id,team_name,team_color,color,interval_seconds,started_at,ended_at,status,distance,point_count,error,uploaded_at";
function normalize(row) {
  return {...row, started_at:Number(row.started_at), ended_at:Number(row.ended_at), distance:Number(row.distance)};
}

function createMovementTrackStore(query = pgQuery) {
  return {
    async list(page = 1) {
      const count = await query("SELECT COUNT(*)::int AS total FROM public.movement_tracks WHERE use_yn=TRUE AND point_count>0");
      const result = await query(
        `SELECT ${columns} FROM public.movement_tracks WHERE use_yn=TRUE AND point_count>0 ORDER BY started_at DESC,id DESC LIMIT $1 OFFSET $2`,
        [100, (page - 1) * 100]
      );
      return {ok:true, items:result.rows.map(normalize), total:count.rows[0].total, page, pageSize:100};
    },
    async detail(id) {
      const result = await query(
        `SELECT ${columns},points FROM public.movement_tracks WHERE id=$1::uuid AND use_yn=TRUE AND point_count>0`, [id]
      );
      return result.rows[0] ? normalize(result.rows[0]) : null;
    }
  };
}
module.exports = { createMovementTrackStore };
