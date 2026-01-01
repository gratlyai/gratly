from getalldata import main


def handler(event, context):
    main()
    return {"status": "ok"}
