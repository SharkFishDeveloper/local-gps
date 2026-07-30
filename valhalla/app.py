from fastapi import FastAPI, HTTPException
from valhalla import Actor
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Valhalla API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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