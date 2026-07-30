from fastapi import FastAPI, HTTPException
from valhalla import Actor

app = FastAPI(
    title="Valhalla API",
    version="1.0.0"
)

# Load once at startup
actor = Actor("valhalla.json")


@app.get("/")
def root():
    return {"status": "running"}


@app.post("/route")
def route(request: dict):
    try:
        return actor.route(request)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/locate")
def locate(request: dict):
    try:
        return actor.locate(request)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/isochrone")
def isochrone(request: dict):
    try:
        return actor.isochrone(request)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/trace_route")
def trace_route(request: dict):
    try:
        return actor.trace_route(request)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/trace_attributes")
def trace_attributes(request: dict):
    try:
        return actor.trace_attributes(request)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/sources_to_targets")
def sources_to_targets(request: dict):
    try:
        return actor.sources_to_targets(request)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))