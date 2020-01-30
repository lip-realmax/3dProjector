# 3dProjector

## Remarks

X11 development package needed to be installed
``
sudo apt-get install xorg-dev
``

### Supervisor - Keeping the software running

Starting the software and keeping it running is the job of supervisor, this program will make sure the camera software allways runs, this can be installed using the following command.

```bash
sudo apt-get install git supervisor
```

Supervisor can then be setup with the 3d scanner application by copying the supplied config file into the final location using the following command
```bash
cp /home/pi/3dProjector/projector.conf /etc/supervisor/conf.d/projector.conf
```
You can now tell supervisor to identify the new config file and start running.

```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo service supervisor restart
```
Now whenever the system starts up supervisor will start the camera application which will connect to the server software automatically.

