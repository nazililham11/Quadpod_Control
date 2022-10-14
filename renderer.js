const { SerialPort, ReadlineParser } = require('serialport')
const parser = new ReadlineParser()
const KEEP = undefined
var port = undefined

const app = new Vue({
    el: "#app",
    data(){
        return {
            active_tab: 0,
            isOpen: false,
            leg: [
                {x: 0, y: 0, z: 0},
                {x: 0, y: 0, z: 0},
                {x: 0, y: 0, z: 0},
                {x: 0, y: 0, z: 0},
            ],
            servo: {
                0: {0: 0, 1: 0, 2: 0},
                1: {0: 0, 1: 0, 2: 0},
                2: {0: 0, 1: 0, 2: 0},
                3: {0: 0, 1: 0, 2: 0},
            },
            serials: [],
            selected_serial: {path:'', friendlyName:'', manufacturer:''},

            // Ukuran kaki
            coxa_len: 25,  // Coxa (mm)
            femur_len: 42, // Femur (mm)
            tibia_len: 72, // Coxa (mm)

            // Gait
            z_base: -50,
            z_stand: -80,
            z_up: -65,
            x_base: 62,
            x_offset: 0,
            y_base: 0,
            y_step: 40,

            forward_steps: 3,
        }
    },
    methods: {
        async listSerialPorts() {
            await SerialPort.list().then((ports, err) => {
                if (err) {
                    console.error(err.message)
                    return
                }        
                if (ports.length === 0) {
                    console.error('No ports discovered')
                }
                this.serials = ports.map(i => {
                    return {path : i.path, friendlyName: i.friendlyName, manufacturer: i.manufacturer}
                })
            })
        },
        
        listPorts() {
            this.listSerialPorts();
            setTimeout(this.listPorts, 5000);
        },
        openSerial(serial){

            port = new SerialPort({
                path: serial.path,
                baudRate: 115200,
                autoOpen: true
            })
            port.open((err) => {
                // if (err)  
                //     console.error('Error opening port: ', err.message)
            })
            port.on('close', () => {
                console.log('Port Closed')
                this.isOpen = false
                this.active_tab = 0
                this.selected_serial = {path:'', friendlyName:'', manufacturer:''}
            })
            port.on('open', () => {
                console.log('Port Opened')
                this.isOpen = true
                this.selected_serial = serial
                port.pipe(parser)
                parser.on('data', this.onMessage)
                port.write("[init]\r\n")
            })
        },
        closeSerial(){
            port.close()
        },

        onMessage(msg){
            var obj = undefined
            msg = msg + ""
            if (msg.charAt(0) == '{'){
                try {
                    obj = JSON.parse(msg)
                } catch {
                    console.log(msg)
                    return
                }
            } else {
                console.log(msg)
                return
            }
            
            if (obj.servo !== undefined){
                const servo = obj.servo
                const part = obj.part
                const angle = obj.angle

                if (servo < 0 ||  servo > 3) return
                if (part < 0 ||  part > 3) return
                
                this.servo[servo][part] = angle
                // console.log("servo", obj)
            }
            else if (obj.leg !== undefined){
                const leg = obj.leg
                const x = obj.x
                const y = obj.y
                const z = obj.z
                if (leg < 0 ||  leg > 3) return
                
                this.leg[leg].x = x
                this.leg[leg].y = y
                this.leg[leg].z = z
                // console.log("leg", obj)
            }

        },

        servoWrite(leg, part = -1){
            if (!this.isOpen) return
            if (leg < 0 || leg > 3) return

            if (part > -1 && part < 4){
                const value = parseInt(this.servo[leg][part])
                let cmd = ""
                for (i = 0; i < 3; i++){
                    if (i === part)
                        cmd = cmd + " " + value
                    else 
                        cmd = cmd + " 255" 
                }
                port.write(`[leg ${leg}${cmd}]`)
            } else {
                const value = [ 
                    parseInt(this.servo[leg]['0']),
                    parseInt(this.servo[leg]['1']),
                    parseInt(this.servo[leg]['2']),
                ]
                port.write(`[leg ${leg} ${value[0]} ${value[1]} ${value[2]}]\r\n`)
            }
        },
        setSite(leg, x, y, z){
            if (!this.isOpen) return
            
            // console.log(`leg ${leg} to x: ${x||'KEEP'}, y: ${y||'KEEP'}, z: ${z||'KEEP'}`)

            x = x || this.leg[leg].x
            y = y || this.leg[leg].y
            z = z || this.leg[leg].z

            let result = this.cartesianToPolar(x,y,z)
            result = this.polarToServo(leg, result.alpha, result.beta, result.gamma)

            this.servo[leg]['0'] = result.gamma.toFixed(2)
            this.servo[leg]['1'] = result.alpha.toFixed(2)
            this.servo[leg]['2'] = result.beta.toFixed(2)

            this.servoWrite(leg)
        },
        setServoDefault(leg){
            this.servo[leg]['0'] = 90
            this.servo[leg]['1'] = 90
            this.servo[leg]['2'] = 90
            this.servoWrite(leg)
        },
        setSiteDefault(leg){
            this.setSite(leg, this.x_base, this.y_base, this.z_base)
        },
        cartesianToPolar(x, y, z){
            const coxa_len = this.coxa_len
            const femur_len = this.femur_len
            const tibia_len = this.tibia_len
            let v, w, alpha, beta, gamma;

            w = (x >= 0 ? 1 : -1) * (Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)));
            v = w - coxa_len;

            alpha = Math.atan2(z, v) + Math.acos((Math.pow(femur_len, 2) - Math.pow(tibia_len, 2) + Math.pow(v, 2) + Math.pow(z, 2)) / 2 / femur_len / Math.sqrt(Math.pow(v, 2) + Math.pow(z, 2)));
            beta = Math.acos((Math.pow(femur_len, 2) + Math.pow(tibia_len, 2) - Math.pow(v, 2) - Math.pow(z, 2)) / 2 / femur_len / tibia_len);

            gamma = (w >= 0) ? Math.atan2(y, x) : Math.atan2(-y, -x);

            // Ubah Radian ke Derajat
            alpha = alpha / Math.PI * 180;
            beta = beta / Math.PI * 180;
            gamma = gamma / Math.PI * 180;

            return {alpha, beta, gamma}
        },
        polarToServo(leg, alpha, beta, gamma){
            if (leg == 1 || leg == 3) {// (1) Belakang Kanan // (3) Depan Kiri
                return {
                    alpha: 90 - alpha,
                    beta: beta,
                    gamma: 90 - gamma,
                }
            } else if (leg == 2 || leg == 0) { // (2) Belakang Kiri // (0) Depan Kanan 
                return {
                    alpha: 90 + alpha,
                    beta: 180 - beta,
                    gamma: gamma + 90,
                }
            }
        },
        sit(){
            console.log('sit')
            for (i = 0; i < 4; i++){
                this.setSite(i, KEEP, KEEP, this.z_base);
                this.setSite(i, KEEP, KEEP, this.z_base);
                this.setSite(i, KEEP, KEEP, this.z_base);
                this.setSite(i, KEEP, KEEP, this.z_base);
            }
        },
        stand(){
            console.log('stand')
            for (i = 0; i < 4; i++){
                this.setSite(i, KEEP, KEEP, this.z_stand);
                this.setSite(i, KEEP, KEEP, this.z_stand);
                this.setSite(i, KEEP, KEEP, this.z_stand);
                this.setSite(i, KEEP, KEEP, this.z_stand);
            }
        },
        delay(delayMs){
            return new Promise(resolve => setTimeout(resolve, delayMs));
        },          
        async forward(step){
            console.log('step forward for '+step+' step')
            const z_base = this.z_base
            const z_stand = this.z_stand
            const z_up = this.z_up
            const x_base = this.x_base
            const x_offset = this.x_offset
            const y_base = this.y_base
            const y_step = this.y_step
            const short_delay = 500
            const long_delay = 1000


            while (step > 0){
                step = step - 1
                if (this.leg[2].y == y_base){
                    this.setSite(3, x_base + x_offset, y_base, z_base);
                    await this.delay(short_delay)
                    this.setSite(2, x_base + x_offset, y_base, z_up);
                    await this.delay(short_delay)
                    this.setSite(2, x_base + x_offset, y_base + y_step, z_up);
                    await this.delay(short_delay)
                    this.setSite(2, x_base + x_offset, y_base + y_step, z_base);
                    await this.delay(short_delay)
                    
                    this.setSite(0, x_base + x_offset, y_base, z_base);
                    this.setSite(1, x_base + x_offset, y_base + y_step, z_base);
                    this.setSite(2, x_base - x_offset, y_base + y_step, z_base);
                    this.setSite(3, x_base - x_offset, y_base + y_step, z_base);
                    await this.delay(long_delay)
                    
                    await this.delay(short_delay)
                    this.setSite(1, x_base + x_offset, y_base + y_step, z_up);
                    await this.delay(short_delay)
                    this.setSite(1, x_base + x_offset, y_base, z_up);
                    await this.delay(short_delay)
                    this.setSite(1, x_base + x_offset, y_base, z_base);
                    await this.delay(short_delay)
                } else {
                    this.setSite(1, x_base + x_offset, y_base, z_base);
                    await this.delay(short_delay)
                    
                    this.setSite(0, x_base + x_offset, y_base, z_up);
                    await this.delay(short_delay)
                    this.setSite(0, x_base + x_offset, y_base + y_step, z_up);
                    await this.delay(short_delay)
                    this.setSite(0, x_base + x_offset, y_base + y_step, z_base);
                    await this.delay(short_delay)
                    
                    this.setSite(0, x_base - x_offset, y_base + y_step, z_base);
                    this.setSite(1, x_base - x_offset, y_base + y_step, z_base);
                    this.setSite(2, x_base + x_offset, y_base, z_base);
                    this.setSite(3, x_base + x_offset, y_base + y_step, z_base);
                    await this.delay(long_delay)
                    
                    await this.delay(short_delay)
                    this.setSite(3, x_base + x_offset, y_base + y_step, z_up);
                    await this.delay(short_delay)
                    this.setSite(3, x_base + x_offset, y_base, z_up);
                    await this.delay(short_delay)
                    this.setSite(3, x_base + x_offset, y_base, z_base);
                    await this.delay(short_delay)
                }
            }

        },
    },
    computed: {
        servo_menus(){
            return [
                { title: 'Leg Front Left', leg: 3 },
                { title: 'Leg Front Right', leg: 0 },
                { title: 'Leg Rear Left', leg: 2 },
                { title: 'Leg Rear Right', leg: 1 },
            ]
        },
        leg_site_menus(){
            return [
                { title: 'Leg Front Left', leg: 3 },
                { title: 'Leg Front Right', leg: 0 },
                { title: 'Leg Rear Left', leg: 2 },
                { title: 'Leg Rear Right', leg: 1 },
            ]
        },
    },
    mounted(){
        setTimeout(this.listPorts, 5000);
        this.listSerialPorts()

    },
    unmounted(){
        port.close()
    }
})