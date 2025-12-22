import requests
import json
import configparser
import pymysql
from datetime import datetime, date, time, timedelta,timezone
import pytz
from zoneinfo import ZoneInfo

def load_config(path):
    """
    Reads configuration from a specified file.
    """
    config = configparser.ConfigParser()
    config.read(path)
    return config

def convert_utc_pacific(utc_dt):
    if utc_dt is None:
        return None

    # Replace '+0000' or '-0000' with '+00:00' or '-00:00'
    if isinstance(utc_dt, str):
        # Fix timezone format
        if len(utc_dt) > 5 and (utc_dt[-5] in ['+', '-']) and utc_dt[-5:] not in ['+00:00', '-00:00']:
            utc_dt = utc_dt[:-2] + ':' + utc_dt[-2:]
        utc_dt = datetime.fromisoformat(utc_dt)

    # If naive → assume UTC
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=ZoneInfo("UTC"))

    # Convert to Pacific
    return utc_dt.astimezone(ZoneInfo("America/Los_Angeles"))
        
def convert_pacific_utc(dt):
    """
    Convert a datetime (naive or aware) in Pacific time to UTC
    and return formatted as 'YYYY-MM-DDTHH:MM:SS.000-0000'.
    """
    pacific_tz = pytz.timezone('US/Pacific')

    # If string is passed, try parsing full datetime
    if isinstance(dt, str):
        # Try parsing with full datetime first
        try:
            dt = datetime.strptime(dt, '%Y-%m-%d %H:%M:%S')
        except ValueError:
            # fallback to just date
            dt = datetime.strptime(dt, '%Y-%m-%d')

    # If naive, localize to Pacific
    if dt.tzinfo is None:
        dt = pacific_tz.localize(dt)

    # Convert to UTC
    dt_utc = dt.astimezone(pytz.utc)

    return dt_utc.strftime('%Y-%m-%dT%H:%M:%S.000-0000')



# Get all parameters for dates to be passed in APIs

start_date_time = datetime.combine(date.today(), time(0, 0, 1))  # 00:00:01
start_date = convert_pacific_utc(start_date_time.strftime('%Y-%m-%d'))
end_datetime = datetime.combine(date.today(), time.min) + timedelta(days=1) - timedelta(seconds=1)
end_date = convert_pacific_utc(end_datetime.strftime('%Y-%m-%d'))
business_date = date.today().strftime('%Y%m%d')

def main():
    config = load_config('setting.ini')
    
    # Database connection details
    db_config = {
        'host': config['DATABASE']['host'],
        'user': config['DATABASE']['user'],
        'password': config['DATABASE']['password'],
        'database': config['DATABASE']['database'],
        'connect_timeout': 10
    }

    request_timeout = (10, 30)
    
    # Get all the URLs from the setting.ini 
    
    urls = config['URLS']['url']
    delimiter = ','
    all_url = urls.split(delimiter)
    
    # Initiate the MySQL connection
    
    print("Connecting to database...")
    conn = pymysql.connect(**db_config, cursorclass=pymysql.cursors.DictCursor)
    print("Database connected.")
    cursor = conn.cursor()
    
    print("Fetching onboarding records...")
    cursor.execute("SELECT RESTAURANTGUID,SECRETKEY,CLIENTSECRET,USERACCESSTYPE from GRATLYDB.SRC_ONBOARDING")
    get_results = cursor.fetchall()
    print(f"Found {len(get_results)} onboarding records.")
    
    for row in get_results:
        payload = {
        "clientId": row['SECRETKEY'],
        "clientSecret": row['CLIENTSECRET'],
        "userAccessType": row['USERACCESSTYPE']
        }
        headers_init = row['RESTAURANTGUID']
        headers = {"Content-Type": "application/json"}
        authurl = 'https://ws-api.toasttab.com/authentication/v1/authentication/login'
        print(f"Authenticating restaurant {headers_init}...")
        response = requests.post(authurl, json=payload, headers=headers, timeout=request_timeout)
        
        data = response.json()

        pretty_json_output = json.dumps(data, indent=4)
        access_token = json.loads(pretty_json_output)
        accesstoken = f"Bearer {access_token['token']['accessToken']}"
        
        headers = {
        "Toast-Restaurant-External-ID": headers_init,
        "Authorization": accesstoken
        }
                

        for url in all_url:
            # print(f"URL IS {url}")
    
            if url == 'https://ws-api.toasttab.com/restaurants/v1/restaurants/':
                url = f"{url}{headers_init}"
                # print(f"URL IS {url}")
                print(f"Fetching restaurant details for {headers_init}...")
                response = requests.get(url, headers=headers, timeout=request_timeout)
                data = response.json()
                
                # pretty_json_output = json.dumps(data, indent=4)
                # with open('getrestaurantdetails.json', 'w') as json_file:
                    # json_file.write(pretty_json_output)
                    
                # SQL query to insert data
                restaurant_sql_query = "INSERT INTO GRATLYDB.SRC_RESTAURANTDETAILS (RESTAURANTGUID,RESTAURANTNAME,LOCATIONNAME,LOCATIONCODE,DESCRIPTION,TIMEZONE,CURRENCYCODE,FIRSTBUSINESSDATE,ARCHIVED,ADDRESS1,ADDRESS2,CITY,STATECODE,ZIPCODE,COUNTRY,PHONE,WEBSITE,ORDERONLINE) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                restaurant_sql_data = [(headers_init,data['general']['name'],data['general']['locationName'],data['general']['locationCode'],data['general']['description'],data['general']['timeZone'],data['general']['currencyCode'],data['general']['firstBusinessDate'],data['general']['archived'],data['location']['address1'],data['location']['address2'],
                                        data['location']['city'],data['location']['stateCode'],data['location']['zipCode'],data['location']['country'],data['location']['phone'],data['urls']['website'],data['urls']['orderOnline'])]

                try:
                    cursor.executemany(restaurant_sql_query, restaurant_sql_data)
                    conn.commit()
                except:
                    conn.rollback()
            
            if url == 'https://ws-api.toasttab.com/labor/v1/jobs':
                print(f"Fetching jobs for {headers_init}...")
                response = requests.get(url, headers=headers, timeout=request_timeout)
                data = response.json()    
                
                # SQL query to insert data
                jobs_sql_query = "INSERT INTO GRATLYDB.SRC_JOBS(RESTAURANTGUID,JOBGUID,JOBTITLE,ENTITYTYPE,CREATEDDATE,DELETED,DELETEDDATE,CODE,TIPPED,DEFAULTWAGE,WAGEFREQUENCY) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                jobs_sql_data = [(headers_init,record['guid'],record['title'],record['entityType'],record['createdDate'][0:10],record['deleted'],record['deletedDate'][0:10],record['code'],record['tipped'],record['defaultWage'],record['wageFrequency']) for record in data]

                try:
                    cursor.executemany(jobs_sql_query, jobs_sql_data)
                    conn.commit()  
                except:
                    conn.rollback()   
                
            if url == 'https://ws-api.toasttab.com/labor/v1/employees':
                print(f"Fetching employees for {headers_init}...")
                response = requests.get(url, headers=headers, timeout=request_timeout)
                data = response.json()    
                
                # SQL query to insert data
                employees_sql_query = "INSERT INTO GRATLYDB.SRC_EMPLOYEES (RESTAURANTGUID,EMPLOYEEGUID,EMPLOYEEFNAME,EMPLOYEELNAME,CHOSENNAME,PHONENUMBER,EMAIL,DELETED,DELETEDDATE) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
                employees_sql_data = [(headers_init,record['guid'],record['firstName'],record['lastName'],record['chosenName'],record['phoneNumber'],record['email'],record['deleted'],record['deletedDate'][0:10]) for record in data]

                try:
                    cursor.executemany(employees_sql_query, employees_sql_data)
                    conn.commit() 
                except:
                    conn.rollback()    
                
                # Prepare data for insertion (list of tuples)
                employeejobs_to_insert = []
                
                # SQL query to insert data
                employee_job_sql_query = "INSERT INTO GRATLYDB.SRC_EMPLOYEEROLE(RESTAURANTGUID,EMPLOYEEGUID,NAME,JOBGUID) VALUES (%s, %s, %s, %s)"
                
                for record in data:
                    restaurantID = headers_init
                    employeeID = record['guid']
                    name = record['firstName'] + ' ' + record['lastName']
                    for job in record['jobReferences']:
                        if job['guid'] is None:
                            jobID = 'N/A'
                        else:
                            jobID = job['guid']
                        employeejobs_to_insert.append([restaurantID,employeeID,name,jobID])
                        
                try:
                    cursor.executemany(employee_job_sql_query, employeejobs_to_insert)
                    conn.commit()
                except:
                    conn.rollback()    
                
            if url == 'https://ws-api.toasttab.com/labor/v1/timeEntries':
                
                query = {
                    "startDate": start_date,
                    "endDate": end_date,
                    "includeArchived": "true",
                    "includeMissedBreaks": "true"
                    }
                print(f"Fetching time entries for {headers_init}...")
                response = requests.get(url, headers=headers, params=query, timeout=request_timeout)
                data = response.json()   
                 
                timeentries_sql_data = []
                
                # SQL query to insert data
                timeentries_sql_query = """INSERT INTO GRATLYDB.SRC_TIMEENTRIES(RESTAURANTGUID,TIMEENTRYGUID,ENTITYTYPE,EXTERNALID,EMPLOYEEGUID,JOBID,SHIFTREFERENCE,INDATE,OUTDATE,
                                        BUSINESSDATE,REGULARHOURS,OVERTIMEHOURS,HOURLYWAGE,TIPSWITHHELD,NONCASHSALES,CASHSALES,NONCASHGRATUITYSERVICECHARGES,CASHGRATUITYSERVICECHARGES,
                                        NONCASHTIPS,DECLAREDCASHTIPS,AUTOCLOCKEDOUT,DELETED,CREATEDDATE,MODIFIEDDATE,DELETEDDATE) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"""
                

                timeentries_sql_data = [(headers_init,record['guid'],record['entityType'],record['externalId'],record['employeeReference']['guid'],record['jobReference']['guid'],record['shiftReference'],
                                                convert_utc_pacific(record['inDate']),convert_utc_pacific(record['outDate']),record['businessDate'],record['regularHours'],record['overtimeHours'],record['hourlyWage'],
                                                record['tipsWithheld'],record['nonCashSales'],record['cashSales'],record['nonCashGratuityServiceCharges'],record['cashGratuityServiceCharges'],record['nonCashTips'],
                                                record['declaredCashTips'],record['autoClockedOut'],record['deleted'],record['createdDate'],record['modifiedDate'],record.get('deletedDate',None)) for record in data]
                
                try:
                    cursor.executemany(timeentries_sql_query, timeentries_sql_data)
                    conn.commit()  
                except:
                    conn.rollback()   
                    
            if url == 'https://ws-api.toasttab.com/config/v2/tables':
                        
                print(f"Fetching tables for {headers_init}...")
                response = requests.get(url, headers=headers, timeout=request_timeout)
                data = response.json()    
                
                # SQL query to insert data
                tables_sql_query = "INSERT INTO GRATLYDB.SRC_TABLES(RESTAURANTGUID,TABLEGUID,ENTITYTYPE,TABLENAME) VALUES (%s, %s, %s, %s)"
                
                tables_sql_data = [(headers_init,record['guid'],record['entityType'],record['name']) for record in data]
                        
                try:
                    cursor.executemany(tables_sql_query, tables_sql_data)
                    conn.commit()  
                except:
                    conn.rollback()   
                
            if url == 'https://ws-api.toasttab.com/orders/v2/ordersBulk':
                query = {
                        "businessDate": business_date
                        }
                print(f"Fetching orders for {headers_init}...")
                response = requests.get(url, headers=headers, params=query, timeout=request_timeout)
                data = response.json()    
                
                all_orders_sql_data = []
                
                # SQL query to insert data
                all_orders_sql_query = """INSERT INTO GRATLYDB.SRC_ALLORDERS(RESTAURANTGUID,ORDERGUID,DISPLAYNUMBER,BUSINESSDATE,ORDERSOURCE,TABLEGUID,ORDERPAIDDATE,VOIDED,OPENEDDATE,PREPTIME,PAYMENTTYPE,REFUNDSTATUS,PAYMENTSTATUS,NETAMOUNT,
                                                    TIPAMOUNT,TAXAMOUNT,TOTALAMOUNT,EMPLOYEEGUID,NUMBEROFGUESTS,DURATION,APPROVALSTATUS) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"""
                
                for record in data:
                    restaurantID = headers_init
                    orderID = record['guid']
                    displayNumber = record['displayNumber']
                    businessDate = record['businessDate']
                    orderSource = record['source']
                    tableID = (record.get("table") or {}).get("guid"," ") 
                    if record.get("checks", [{}])[0].get("paymentStatus") != 'OPEN':
                        orderPaidDate = convert_utc_pacific(record['paidDate'])
                        paymentType = record.get("checks", [{}])[0].get("payments", [{}])[0].get("type")
                        refundStatus = record.get("checks", [{}])[0].get("payments", [{}])[0].get("refundStatus")
                        paymentStatus = record.get("checks", [{}])[0].get("paymentStatus")
                        netAmount = record.get("checks", [{}])[0].get("payments", [{}])[0].get("amount")
                        tipAmount = record.get("checks", [{}])[0].get("payments", [{}])[0].get("tipAmount")
                        taxAmount = record.get("checks", [{}])[0].get("taxAmount")
                        totalAmount = record.get("checks", [{}])[0].get("totalAmount")
                    else:
                        orderPaidDate = '' 
                        paymentType = ''
                        refundStatus = ''
                        paymentStatus = ''
                        netAmount = 0.0
                        tipAmount = 0.0
                        taxAmount = 0.0
                        totalAmount = 0.0
                    voided = record['voided']
                    openedDate = convert_utc_pacific(record['openedDate'])
                    prepTime = record['requiredPrepTime']
                    employeeID = record['server']['guid']
                    numberOfGuests = record['numberOfGuests']
                    duration = record['duration']
                    approvalStatus = record['approvalStatus']

                    all_orders_sql_data.append([restaurantID,orderID,displayNumber,businessDate,orderSource,tableID,orderPaidDate,voided,openedDate,prepTime,paymentType,refundStatus,paymentStatus,netAmount,
                                                        tipAmount,taxAmount,totalAmount,employeeID,numberOfGuests,duration,approvalStatus])

                # all_orders_sql_data = [(headers_init,record['guid'],record['displayNumber'],record['businessDate'],record['source'],convert_utc_pacific(record['paidDate']),record['voided'],convert_utc_pacific(record['openedDate']),
                                        # record['requiredPrepTime'],record['checks']['payments']['type'],record['checks']['payments']['refundStatus'],record['checks']['paymentStatus'],record['checks']['payments']['amount'],
                                        # record['checks']['payments']['tipAmount'],record['checks']['taxAmount'],record['checks']['totalAmount'],record['server']['guid'],record['numberOfGuests'],record['duration'],record['approvalStatus']) for record in data]

                try:
                    cursor.executemany(all_orders_sql_query, all_orders_sql_data)
                    conn.commit()  
                except:
                    conn.rollback()   
                              
                
        cursor.close()
        conn.close()

if __name__ == "__main__":
    main()
